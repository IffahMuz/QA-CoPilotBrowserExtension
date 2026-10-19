using System.ComponentModel.DataAnnotations.Schema;

namespace QaCopilot.Backend.Data;

[Table("bug_reports")]
public class BugReport
{
    [Column("id")] public long Id { get; set; }
    [Column("capture_id")] public Guid CaptureId { get; set; }
    [Column("created_at")] public DateTimeOffset CreatedAt { get; set; }
    [Column("updated_at")] public DateTimeOffset UpdatedAt { get; set; }
    [Column("status")] public string Status { get; set; } = "RECEIVED";
    [Column("target_url")] public string? TargetUrl { get; set; }
    [Column("module")] public string? Module { get; set; }
    [Column("severity")] public string? Severity { get; set; }
    [Column("priority")] public string? Priority { get; set; }
    [Column("draft_report", TypeName = "jsonb")] public string? DraftReport { get; set; }
    [Column("edited_report", TypeName = "jsonb")] public string? EditedReport { get; set; }
    [Column("ado_work_item_id")] public long? AdoWorkItemId { get; set; }
    [Column("evidence_manifest", TypeName = "jsonb")] public string? EvidenceManifest { get; set; }
    [Column("error_details")] public string? ErrorDetails { get; set; }
}
