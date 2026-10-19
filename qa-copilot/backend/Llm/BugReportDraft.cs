namespace QaCopilot.Backend.Llm;

public record BugReportDraft(
    string   Title,
    string   BugType,          // "API" | "UI" | "Both"
    string   Severity,         // Critical | High | Medium | Low
    string   Priority,         // High | Medium | Low
    string[] ReproSteps,       // env-first, one atomic action per item
    string   Expected,         // definitive resolved state
    string[] Observations,     // actual — one distinct fact per bullet
    string   SuspectedModule,
    string?  AssignedTeam,
    // Factual metadata injected from session — not LLM-generated
    string?  TargetUrl    = null,
    string?  Environment  = null,
    string?  DealerId     = null,
    string?  DmsDealerId  = null
);
