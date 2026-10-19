using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using QaCopilot.Backend.Evidence;
using QaCopilot.Backend.Llm;

namespace QaCopilot.Backend.Ado;

file record AdoAttachment(string Url);
file record AdoWorkItem(long Id);

public class AdoRestClient : IAdoClient
{
    private readonly HttpClient _http;
    private readonly string _org;
    private readonly string _project;
    private readonly ILogger<AdoRestClient> _log;

    private static readonly JsonSerializerOptions CiOpts =
        new() { PropertyNameCaseInsensitive = true };

    public AdoRestClient(HttpClient http, IConfiguration cfg, ILogger<AdoRestClient> log)
    {
        _http = http;
        _log  = log;
        _org  = cfg["Ado:OrgUrl"]!;
        _project = cfg["Ado:Project"]!;
        var pat = cfg["Ado:Pat"]!;
        var basic = Convert.ToBase64String(Encoding.ASCII.GetBytes($":{pat}"));
        _http.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Basic", basic);
    }

    public async Task<long> CreateBugWithAttachmentsAsync(
        BugReportDraft r, EvidenceManifest manifest, IEvidenceStore store)
    {
        // ── Read session data for System Details ──────────────────────────────────
        string? browserName = null, osName = null, loggedInUser = null, dmsDealerId = null;

        if (manifest.Files.TryGetValue("session", out var sessionPath))
        {
            try
            {
                await using var ss = await store.OpenAsync(sessionPath);
                using var sd = await JsonDocument.ParseAsync(ss);
                var se = sd.RootElement;

                if (se.TryGetProperty("browser", out var bEl))
                    browserName = ParseBrowserName(bEl.GetString());
                if (se.TryGetProperty("os", out var osEl))
                    osName = ParseOsName(osEl.GetString());
                if (se.TryGetProperty("loggedInUser", out var luEl) && luEl.ValueKind == JsonValueKind.String)
                    loggedInUser = luEl.GetString();
            }
            catch { }
        }

        // Extract dmsDealerId and fallback loggedInUser from environment localStorage
        if (manifest.Files.TryGetValue("environment", out var envPath))
        {
            try
            {
                await using var es = await store.OpenAsync(envPath);
                using var ed = await JsonDocument.ParseAsync(es);
                if (ed.RootElement.TryGetProperty("localStorage", out var ls) &&
                    ls.TryGetProperty("persist:root", out var prEl) &&
                    prEl.ValueKind == JsonValueKind.String)
                {
                    using var persistRoot = JsonDocument.Parse(prEl.GetString() ?? "{}");
                    if (persistRoot.RootElement.TryGetProperty("auth", out var authStrEl) &&
                        authStrEl.ValueKind == JsonValueKind.String)
                    {
                        using var auth = JsonDocument.Parse(authStrEl.GetString() ?? "{}");
                        var a = auth.RootElement;
                        if (a.TryGetProperty("dmsDealerId", out var dmsEl))
                            dmsDealerId = dmsEl.ValueKind == JsonValueKind.Number
                                ? dmsEl.GetInt32().ToString()
                                : dmsEl.GetString();
                        if (loggedInUser is null && a.TryGetProperty("userName", out var unEl))
                            loggedInUser = unEl.GetString();
                    }
                }
            }
            catch { }
        }

        // ── Parse HAR: Network HTML table + extract customerId / orderId ──────────
        var networkHtml = "<p>No network data captured.</p>";
        string? customerId = null, orderId = null;

        if (manifest.Files.TryGetValue("har", out var harPath))
        {
            try
            {
                await using var hs = await store.OpenAsync(harPath);
                (networkHtml, customerId, orderId) = BuildNetworkHtml(hs);
            }
            catch { }
        }

        // ── Upload evidence files ─────────────────────────────────────────────────
        // Only two files are uploaded:
        //   environment — the sole entry in the ADO Attachments tab.
        //   screenshot  — uploaded for its ADO URL so it can be embedded in the
        //                 ReproSteps HTML; deliberately NOT added as a relation.
        // Everything else (actions, console, har, session, video) is already rendered
        // into the ReproSteps document, so attaching it again is redundant.
        var upload = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "environment", "screenshot" };

        var refs = new List<(string name, string url)>();
        string? screenshotAdoUrl = null;

        foreach (var (name, path) in manifest.Files)
        {
            if (!upload.Contains(name)) continue;

            await using var s = await store.OpenAsync(path);
            var up = await _http.PostAsync(
                $"{_org}/{_project}/_apis/wit/attachments?fileName={Uri.EscapeDataString(Path.GetFileName(path))}&api-version=7.0",
                new StreamContent(s));

            var upBody = await up.Content.ReadAsStringAsync();
            if (!up.IsSuccessStatusCode)
            {
                _log.LogWarning("ADO attachment upload failed {status} for {file}: {body}",
                    (int)up.StatusCode, Path.GetFileName(path), upBody[..Math.Min(300, upBody.Length)]);
                continue;
            }

            AdoAttachment? att = null;
            try { att = JsonSerializer.Deserialize<AdoAttachment>(upBody, CiOpts); }
            catch (JsonException ex)
            {
                _log.LogWarning("ADO attachment response not JSON for {file} ({status}): {ex} | body: {body}",
                    Path.GetFileName(path), (int)up.StatusCode, ex.Message,
                    upBody[..Math.Min(300, upBody.Length)]);
            }

            if (att?.Url is null) continue;

            if (name.Equals("screenshot", StringComparison.OrdinalIgnoreCase))
                screenshotAdoUrl = att.Url;   // embedded in HTML; not added as a relation
            else
                refs.Add((name, att.Url));
        }

        // ── Build ReproSteps HTML — four ordered sections ─────────────────────────

        // 1. Repro Steps
        var stepItems = string.Concat(r.ReproSteps.Select(s => $"<li>{System.Net.WebUtility.HtmlEncode(s)}</li>"));
        var obsItems  = r.Observations.Length > 0
            ? string.Concat(r.Observations.Select(o => $"<li>{System.Net.WebUtility.HtmlEncode(o)}</li>"))
            : "<li>See attached evidence.</li>";
        var reproSection =
            "<b>Repro Steps</b>" +
            $"<ul>{stepItems}</ul>" +
            "<div><b>OBSERVATION:</b></div>" +
            $"<ul>{obsItems}</ul>";

        // 2. System Details
        const string TblStyle  = "border-collapse:collapse;width:100%;font-family:sans-serif;font-size:13px;";
        const string ThStyle   = "border:1px solid #999;padding:6px 10px;background:#f0f0f0;text-align:left;font-weight:bold;white-space:nowrap;";
        const string LblStyle  = "border:1px solid #ccc;padding:6px 10px;background:#f7f7f7;font-weight:bold;white-space:nowrap;width:180px;vertical-align:top;";
        const string TdStyle   = "border:1px solid #ccc;padding:6px 10px;vertical-align:top;word-break:break-all;";

        var sysRows = new StringBuilder();
        void SysRow(string label, string? value) =>
            sysRows.Append($"<tr><td style=\"{LblStyle}\">{label}</td><td style=\"{TdStyle}\">{H(value)}</td></tr>");

        SysRow("DMS Dealer ID",  dmsDealerId);
        SysRow("Environment",    r.Environment);
        SysRow("URL",            r.TargetUrl);
        SysRow("Browser",        browserName);
        SysRow("OS",             osName);
        SysRow("Logged-in User", loggedInUser);
        if (customerId is not null) SysRow("Customer ID", customerId);
        if (orderId    is not null) SysRow("Order ID",    orderId);

        var systemSection =
            "<br/><b>System Details</b><br/>" +
            $"<table style=\"{TblStyle}\">" +
            $"<tr><th style=\"{ThStyle}\">Field</th><th style=\"{ThStyle}\">Value</th></tr>" +
            $"{sysRows}</table>";

        // 3. Network
        var networkSection = "<br/><b>Network</b><br/>" + networkHtml;

        // 4. Attachments — screenshot embedded here, not as a separate ADO attachment
        var screenshotHtml = screenshotAdoUrl is not null
            ? $"<img src=\"{screenshotAdoUrl}\" alt=\"Screenshot\" style=\"max-width:100%;\" />"
            : "<i>No screenshot captured.</i>";
        var attachmentsSection = "<br/><b>Attachments</b><br/>" + screenshotHtml;

        var reproHtml = reproSection + systemSection + networkSection + attachmentsSection;

        // ── Acceptance criteria ────────────────────────────────────────────────────
        var acceptanceCriteria =
            $"I know this bug is resolved when:<ul><li>{System.Net.WebUtility.HtmlEncode(r.Expected)}</li></ul>";

        // ── System Info (how found) ────────────────────────────────────────────────
        var systemInfo =
            $"<b>Bug Type:</b> {r.BugType}<br/>" +
            $"<b>Captured URL:</b> {r.TargetUrl}<br/>" +
            $"<b>Environment:</b> {r.Environment}<br/>" +
            $"<b>DMS Dealer ID:</b> {dmsDealerId}<br/>" +
            $"<b>How found:</b> QA Copilot — AI-assisted evidence capture";

        var patch = new List<object>
        {
            new { op = "add", path = "/fields/System.Title",                              value = r.Title },
            new { op = "add", path = "/fields/System.AreaPath",                           value = @"TargetDMS\TargetDMS" },
            new { op = "add", path = "/fields/System.IterationPath",                      value = "TargetDMS" },
            new { op = "add", path = "/fields/Microsoft.VSTS.TCM.ReproSteps",             value = reproHtml },
            new { op = "add", path = "/fields/Microsoft.VSTS.Common.Severity",            value = MapSeverity(r.Severity) },
            new { op = "add", path = "/fields/Microsoft.VSTS.Common.Priority",            value = MapPriority(r.Priority) },
            new { op = "add", path = "/fields/Microsoft.VSTS.Common.ValueArea",           value = "Business" },
            new { op = "add", path = "/fields/Microsoft.VSTS.Common.AcceptanceCriteria",  value = acceptanceCriteria },
            new { op = "add", path = "/fields/Microsoft.VSTS.TCM.SystemInfo",             value = systemInfo },
        };
        patch.AddRange(refs.Select(a => (object)new {
            op = "add", path = "/relations/-",
            value = new { rel = "AttachedFile", url = a.url,
                          attributes = new { comment = a.name } }
        }));

        var content = new StringContent(
            JsonSerializer.Serialize(patch), Encoding.UTF8, "application/json-patch+json");
        var res = await _http.PostAsync(
            $"{_org}/{_project}/_apis/wit/workitems/$Bug?api-version=7.0", content);

        var resBody = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode)
            throw new InvalidOperationException(
                $"ADO work item creation failed {(int)res.StatusCode}: {resBody[..Math.Min(500, resBody.Length)]}");

        var wi = JsonSerializer.Deserialize<AdoWorkItem>(resBody, CiOpts)
                 ?? throw new InvalidOperationException($"ADO work item response was null. Body: {resBody[..Math.Min(300, resBody.Length)]}");
        return wi.Id;
    }

    public string WorkItemUrl(long id) => $"{_org}/{_project}/_workitems/edit/{id}";

    // ── HTML helpers ──────────────────────────────────────────────────────────────

    private static string H(string? s) =>
        string.IsNullOrWhiteSpace(s) ? "—" : System.Net.WebUtility.HtmlEncode(s);

    private static string ParseBrowserName(string? ua)
    {
        if (string.IsNullOrWhiteSpace(ua)) return "Unknown";
        if (ua.Contains("Edg/") || ua.Contains("Edge/")) return "Edge";
        if (ua.Contains("Firefox/"))                      return "Firefox";
        if (ua.Contains("Chrome/"))                       return "Chrome";
        if (ua.Contains("Safari/"))                       return "Safari";
        return "Unknown";
    }

    private static string ParseOsName(string? os)
    {
        if (string.IsNullOrWhiteSpace(os)) return "Unknown";
        var lower = os.ToLowerInvariant();
        if (lower.Contains("win"))    return "Windows";
        if (lower.Contains("mac"))    return "macOS";
        if (lower.Contains("linux"))  return "Linux";
        if (lower.Contains("android")) return "Android";
        if (lower.Contains("ios") || lower.Contains("iphone") || lower.Contains("ipad")) return "iOS";
        return os;
    }

    private static (string html, string? customerId, string? orderId) BuildNetworkHtml(Stream harStream)
    {
        using var doc = JsonDocument.Parse(harStream);
        if (!doc.RootElement.TryGetProperty("log",     out var log)    ||
            !log.TryGetProperty(             "entries", out var entries))
            return ("<p>No network entries found.</p>", null, null);

        const string NTblStyle = "border-collapse:collapse;width:100%;font-family:sans-serif;font-size:12px;";
        const string NThStyle  = "border:1px solid #999;padding:5px 8px;background:#f0f0f0;text-align:left;font-weight:bold;white-space:nowrap;";
        const string NTdStyle  = "border:1px solid #ccc;padding:5px 8px;vertical-align:top;";
        const string NTdMono   = "border:1px solid #ccc;padding:5px 8px;vertical-align:top;font-family:monospace;word-break:break-all;";

        string? customerId = null, orderId = null;
        var rows = new StringBuilder();
        rows.Append($"<tr><th style=\"{NThStyle}\">Method</th><th style=\"{NThStyle}\">Status</th><th style=\"{NThStyle}\">URL</th></tr>");

        foreach (var e in entries.EnumerateArray())
        {
            if (!e.TryGetProperty("request",  out var req))  continue;
            if (!e.TryGetProperty("response", out var resp)) continue;

            var method = req.TryGetProperty("method", out var mEl) ? mEl.GetString() ?? "" : "";
            var url    = req.TryGetProperty("url",    out var uEl) ? uEl.GetString() ?? "" : "";
            var status = resp.TryGetProperty("status", out var stEl) ? stEl.GetInt32() : 0;

            if (url.StartsWith("chrome-extension://", StringComparison.OrdinalIgnoreCase)) continue;

            var statusStyle = status >= 500 ? $"{NTdStyle}background:#fde8e8;color:#c0392b;font-weight:bold;"
                            : status >= 400 ? $"{NTdStyle}background:#fff3e0;color:#e67e22;font-weight:bold;"
                            : NTdStyle;
            rows.Append($"<tr><td style=\"{NTdStyle}\">{H(method)}</td><td style=\"{statusStyle}\">{status}</td><td style=\"{NTdMono}\">{H(url)}</td></tr>");

            // Extract customerId / orderId from POST bodies
            if (method.Equals("POST", StringComparison.OrdinalIgnoreCase) &&
                req.TryGetProperty("postData", out var pd) &&
                pd.TryGetProperty("text", out var bodyEl) &&
                bodyEl.ValueKind == JsonValueKind.String)
            {
                try
                {
                    using var body = JsonDocument.Parse(bodyEl.GetString() ?? "{}");
                    var b = body.RootElement;
                    if (customerId is null && b.TryGetProperty("customerId", out var ciEl))
                        customerId = ciEl.ValueKind == JsonValueKind.Number
                            ? ciEl.GetInt64().ToString() : ciEl.GetString();
                    if (orderId is null)
                    {
                        if (b.TryGetProperty("workOrderId", out var wiEl))
                            orderId = wiEl.ValueKind == JsonValueKind.Number
                                ? wiEl.GetInt64().ToString() : wiEl.GetString();
                        else if (b.TryGetProperty("orderId", out var oiEl))
                            orderId = oiEl.ValueKind == JsonValueKind.Number
                                ? oiEl.GetInt64().ToString() : oiEl.GetString();
                    }
                }
                catch { }
            }
        }

        return ($"<table style=\"{NTblStyle}\">{rows}</table>",
                customerId, orderId);
    }

    // ADO Severity uses "N - Label" format (confirmed from live TargetDMS bugs)
    private static string MapSeverity(string s) => s.ToLower() switch
    {
        "critical" => "1 - Critical",
        "high"     => "2 - High",
        "medium"   => "3 - Medium",
        _          => "4 - Low",
    };

    // ADO Priority is an integer 1–4
    private static int MapPriority(string p) => p.ToLower() switch
    {
        "high"   => 1,
        "medium" => 2,
        "low"    => 3,
        _        => 4,
    };
}
