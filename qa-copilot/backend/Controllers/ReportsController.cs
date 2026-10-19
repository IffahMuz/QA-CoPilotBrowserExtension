using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using QaCopilot.Backend.Ado;
using QaCopilot.Backend.Data;
using QaCopilot.Backend.Evidence;
using QaCopilot.Backend.Llm;
using QaCopilot.Backend.Teams;

namespace QaCopilot.Backend.Controllers;

[ApiController]
[Route("api/reports")]
public class ReportsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IEvidenceStore _store;
    private readonly ILlmProvider _llm;
    private readonly IAdoClient _ado;
    private readonly INotifier _notifier;

    public ReportsController(AppDbContext db, IEvidenceStore store,
        ILlmProvider llm, IAdoClient ado, INotifier notifier)
    {
        _db = db; _store = store; _llm = llm; _ado = ado; _notifier = notifier;
    }

    [HttpPost("{id}/generate")]
    public async Task<IActionResult> Generate(long id)
    {
        var report = await _db.BugReports.FindAsync(id);
        if (report is null) return NotFound();

        // Idempotent: return the existing draft if Claude already ran for this report.
        if (report.DraftReport is not null && report.Status is "DRAFTED" or "EDITED" or "FILED")
            return Ok(JsonSerializer.Deserialize<BugReportDraft>(report.DraftReport,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true }));

        var manifest = JsonSerializer.Deserialize<Dictionary<string, string>>(
            report.EvidenceManifest ?? "{}") ?? new();

        // Load all evidence files from volume so Claude has real data to work with.
        object? actions = null, consoleLogs = null, sessionData = null;
        JsonElement envElement = default;
        List<object>? failedRequests = null;

        if (manifest.TryGetValue("actions", out var aPath))
            try { await using var s = await _store.OpenAsync(aPath); actions = await JsonSerializer.DeserializeAsync<object>(s); } catch { }
        if (manifest.TryGetValue("console", out var cPath))
            try { await using var s = await _store.OpenAsync(cPath); consoleLogs = await JsonSerializer.DeserializeAsync<object>(s); } catch { }
        if (manifest.TryGetValue("environment", out var ePath))
            try { await using var s = await _store.OpenAsync(ePath);
                  using var ed = await JsonDocument.ParseAsync(s);
                  envElement = ed.RootElement.Clone(); } catch { }
        if (manifest.TryGetValue("session", out var sPath))
            try { await using var s = await _store.OpenAsync(sPath); sessionData = await JsonSerializer.DeserializeAsync<object>(s); } catch { }
        if (manifest.TryGetValue("har", out var hPath))
            try { await using var s = await _store.OpenAsync(hPath); failedRequests = ExtractFailedRequests(s); } catch { }

        // ── Trim evidence to keep the prompt small ────────────────────────────────
        // localStorage/sessionStorage can be many KB in Redux apps; the LLM doesn't
        // need raw storage — just featureFlags and roles are signal-bearing.
        object? envSummary = null;
        if (envElement.ValueKind == JsonValueKind.Object)
        {
            envSummary = new
            {
                featureFlags = envElement.TryGetProperty("featureFlags", out var ff) ? ff : (object?)null,
                roles        = envElement.TryGetProperty("roles",        out var rl) ? rl : (object?)null,
            };
        }

        // Drop navigationHistory, featureFlags, userRoles from session — not useful for bug text.
        object? sessionSummary = null;
        if (sessionData is JsonElement sesEl)
        {
            sessionSummary = new
            {
                url          = sesEl.TryGetProperty("url",          out var u)  ? u.GetString()  : null,
                environment  = sesEl.TryGetProperty("environment",  out var ev) ? ev.GetString() : null,
                dealerId     = sesEl.TryGetProperty("dealerId",     out var di) ? di.GetString() : null,
                browser      = sesEl.TryGetProperty("browser",      out var br) ? br.GetString() : null,
                os           = sesEl.TryGetProperty("os",           out var os) ? os.GetString() : null,
                loggedInUser = sesEl.TryGetProperty("loggedInUser", out var lu) ? (object?)lu    : null,
                currentModule= sesEl.TryGetProperty("currentModule",out var cm) ? (object?)cm   : null,
            };
        }

        // Cap console logs and user actions to last 50 entries each.
        static object? Cap(object? data, int max) =>
            data is JsonElement el && el.ValueKind == JsonValueKind.Array
                ? (object)el.EnumerateArray().TakeLast(max).ToArray()
                : data;

        object evidence = new
        {
            targetUrl          = report.TargetUrl,
            session            = sessionSummary,
            reproActions       = Cap(actions, 50),
            consoleLogs        = Cap(consoleLogs, 50),
            failedNetworkRequests = failedRequests,
            environment        = envSummary,
        };

        var draft = await _llm.GenerateAsync(evidence);

        // Inject factual metadata from session — don't let the LLM make these up.
        string? envStr = null, dealerIdStr = null;
        if (sessionData is System.Text.Json.JsonElement sEl)
        {
            if (sEl.TryGetProperty("environment", out var eEl)) envStr = eEl.GetString();
            if (sEl.TryGetProperty("dealerId",    out var dEl)) dealerIdStr = dEl.GetString();
        }

        // Extract dmsDealerId separately from Redux persist auth slice in localStorage.
        string? dmsDealerIdStr = null;
        if (envElement.ValueKind == JsonValueKind.Object)
        {
            try
            {
                if (envElement.TryGetProperty("localStorage", out var ls) &&
                    ls.TryGetProperty("persist:root", out var prEl) &&
                    prEl.ValueKind == JsonValueKind.String)
                {
                    using var persistRoot = JsonDocument.Parse(prEl.GetString() ?? "{}");
                    if (persistRoot.RootElement.TryGetProperty("auth", out var authStrEl) &&
                        authStrEl.ValueKind == JsonValueKind.String)
                    {
                        using var auth = JsonDocument.Parse(authStrEl.GetString() ?? "{}");
                        if (auth.RootElement.TryGetProperty("dmsDealerId", out var dmsEl))
                            dmsDealerIdStr = dmsEl.ValueKind == JsonValueKind.Number
                                ? dmsEl.GetInt32().ToString()
                                : dmsEl.GetString();
                    }
                }
            }
            catch { }
        }

        draft = draft with
        {
            TargetUrl    = report.TargetUrl,
            Environment  = envStr,
            DealerId     = dealerIdStr,
            DmsDealerId  = dmsDealerIdStr,
        };

        report.DraftReport = JsonSerializer.Serialize(draft);
        report.Module = Trunc(draft.SuspectedModule, 255);
        report.Severity = Trunc(draft.Severity, 20);
        report.Priority = Trunc(draft.Priority, 20);
        report.Status = "DRAFTED";
        report.UpdatedAt = DateTimeOffset.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(draft);
    }

    [HttpPost("{id}/file")]
    public async Task<IActionResult> File(long id, [FromBody] BugReportDraft edited)
    {
        var report = await _db.BugReports.FindAsync(id);
        if (report is null) return NotFound();

        report.EditedReport = JsonSerializer.Serialize(edited);
        report.Module = edited.SuspectedModule;
        report.Severity = edited.Severity;
        report.Priority = edited.Priority;
        report.Status = "EDITED";
        report.UpdatedAt = DateTimeOffset.UtcNow;
        await _db.SaveChangesAsync();

        try
        {
            var files = JsonSerializer.Deserialize<Dictionary<string, string>>(
                report.EvidenceManifest ?? "{}") ?? new();
            var manifest = new EvidenceManifest();
            foreach (var (k, v) in files) manifest.Add(k, v);

            var workItemId = await _ado.CreateBugWithAttachmentsAsync(edited, manifest, _store);
            report.AdoWorkItemId = workItemId;
            report.Status = "FILED";
            report.UpdatedAt = DateTimeOffset.UtcNow;
            await _db.SaveChangesAsync();

            var workItemUrl = _ado.WorkItemUrl(workItemId);
            await _notifier.NotifyAsync(new(
                Title:         edited.Title,
                Severity:      edited.Severity,
                Priority:      edited.Priority,
                Module:        edited.SuspectedModule ?? "Unknown",
                BugType:       edited.BugType,
                Environment:   edited.Environment,
                DealerId:      edited.DealerId,
                DmsDealerId:   edited.DmsDealerId,
                TargetUrl:     edited.TargetUrl,
                AssignedTeam:  edited.AssignedTeam,
                AdoWorkItemId: workItemId,
                AdoWorkItemUrl: workItemUrl,
                Expected:      edited.Expected,
                Observations:  edited.Observations
            ));

            return Ok(new
            {
                ado_work_item_id = workItemId,
                url = workItemUrl,
                status = "FILED"
            });
        }
        catch (Exception ex)
        {
            report.Status = "FAILED";
            report.ErrorDetails = ex.Message;
            await _db.SaveChangesAsync();
            return StatusCode(502, new { status = "FAILED", error = ex.Message });
        }
    }

    private static string? Trunc(string? s, int max) =>
        s is null ? null : s.Length <= max ? s : s[..max];

    private static List<object>? ExtractFailedRequests(Stream har)
    {
        try
        {
            using var doc = JsonDocument.Parse(har);
            if (!doc.RootElement.TryGetProperty("log", out var log)) return null;
            if (!log.TryGetProperty("entries", out var entries)) return null;

            var failed = entries.EnumerateArray()
                .Where(e =>
                {
                    if (!e.TryGetProperty("response", out var r)) return false;
                    if (!r.TryGetProperty("status", out var st)) return false;
                    return st.GetInt32() >= 400;
                })
                .Take(30)
                .Select(e => (object)new
                {
                    url    = e.GetProperty("request").GetProperty("url").GetString(),
                    method = e.GetProperty("request").GetProperty("method").GetString(),
                    status = e.GetProperty("response").GetProperty("status").GetInt32(),
                })
                .ToList();

            return failed.Count > 0 ? failed : null;
        }
        catch { return null; }
    }
}
