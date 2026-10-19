namespace QaCopilot.Backend.Llm;

public interface ILlmProvider
{
    Task<BugReportDraft> GenerateAsync(object evidence, CancellationToken ct = default);
}
