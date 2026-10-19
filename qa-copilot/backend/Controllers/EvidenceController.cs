using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using QaCopilot.Backend.Data;
using QaCopilot.Backend.Evidence;

namespace QaCopilot.Backend.Controllers;

[ApiController]
[Route("api/evidence")]
public class EvidenceController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IEvidenceStore _store;

    public EvidenceController(AppDbContext db, IEvidenceStore store)
    {
        _db = db;
        _store = store;
    }

    [HttpPost]
    public async Task<IActionResult> Intake([FromForm] IFormFile package)
    {
        using var stream = package.OpenReadStream();
        var pkg = await JsonSerializer.DeserializeAsync<EvidencePackageDto>(stream,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

        if (pkg is null) return BadRequest("Invalid package");

        var existing = await _db.BugReports.FirstOrDefaultAsync(r => r.CaptureId == pkg.CaptureId);
        if (existing is not null)
            return Ok(new { report_id = existing.Id, capture_id = existing.CaptureId, status = "DUPLICATE" });

        // Extract URL from the session JSON element
        string? targetUrl = null;
        if (pkg.Session.HasValue &&
            pkg.Session.Value.ValueKind == JsonValueKind.Object &&
            pkg.Session.Value.TryGetProperty("url", out var urlEl))
            targetUrl = urlEl.GetString();

        var manifest = await _store.SaveAsync(pkg.CaptureId, Request.Form.Files);

        // Persist all inline evidence so the generate step can read it
        if (pkg.Session.HasValue)
            await _store.WriteJsonAsync(pkg.CaptureId, "session.json", pkg.Session.Value, manifest);
        if (pkg.Console != null)
            await _store.WriteJsonAsync(pkg.CaptureId, "console.json", pkg.Console, manifest);
        if (pkg.Environment != null)
            await _store.WriteJsonAsync(pkg.CaptureId, "environment.json", pkg.Environment, manifest);
        if (pkg.Actions is { Length: > 0 })
            await _store.WriteJsonAsync(pkg.CaptureId, "actions.json", pkg.Actions, manifest);

        var report = new BugReport
        {
            CaptureId = pkg.CaptureId,
            Status = "RECEIVED",
            TargetUrl = targetUrl,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
            EvidenceManifest = JsonSerializer.Serialize(manifest.Files),
        };
        _db.BugReports.Add(report);
        await _db.SaveChangesAsync();

        return Ok(new { report_id = report.Id, capture_id = report.CaptureId, status = "RECEIVED" });
    }
}

file class EvidencePackageDto
{
    [System.Text.Json.Serialization.JsonPropertyName("capture_id")]
    public Guid CaptureId { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("session")]
    public System.Text.Json.JsonElement? Session { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("environment")]
    public object? Environment { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("console")]
    public object? Console { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("actions")]
    public string[]? Actions { get; set; }
}
