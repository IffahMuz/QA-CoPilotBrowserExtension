using QaCopilot.Backend.Evidence;
using QaCopilot.Backend.Llm;

namespace QaCopilot.Backend.Ado;

public interface IAdoClient
{
    Task<long> CreateBugWithAttachmentsAsync(BugReportDraft report, EvidenceManifest manifest, IEvidenceStore store);
    string WorkItemUrl(long id);
}
