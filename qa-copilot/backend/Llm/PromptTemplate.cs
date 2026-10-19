using System.Text.Json;

namespace QaCopilot.Backend.Llm;

public static class PromptTemplate
{
    public const string Version = "v2";

    public static string Build(object evidence)
    {
        var shape = """
            {
              "title": "",
              "bugType": "API | UI | Both",
              "severity": "Critical | High | Medium | Low",
              "priority": "High | Medium | Low",
              "reproSteps": [],
              "expected": "",
              "observations": [],
              "suspectedModule": "",
              "assignedTeam": null
            }
            """;

        return $"""
            You are a senior QA analyst writing a house-style bug report for the TargetDMS QA team.
            Use ONLY the evidence below. Do not invent facts not present in the evidence.
            Respond with ONLY a single JSON object — no markdown, no explanation — matching the shape at the end.

            ═══════════════════════════════════════════════════════════════
            FIELD RULES
            ═══════════════════════════════════════════════════════════════

            ── bugType ──────────────────────────────────────────────────
            "API"  — root cause is a failed/incorrect network request (non-2xx, missing field,
                     wrong data from the server). Evidence: failedNetworkRequests, consoleLogs
                     showing a network error.
            "UI"   — the interface is broken without any corresponding API failure. Evidence:
                     no network errors, but the UI renders incorrectly or a user action fails.
            "Both" — an API failure causes a visible UI breakage. Evidence: a failing request
                     AND the user cannot complete the action in the UI.

            ── title ────────────────────────────────────────────────────
            A declarative negative-state statement — what is broken, which feature/endpoint,
            ending with the environment.
            Patterns (pick the one that fits):
              • <thing> is not <verb>ing
              • Unable to <verb>
              • <thing> returns <status> on <ENV> environment
              • Error <doing X>
              • Able to <do invalid thing>   ← only for things that should be blocked but aren't
            Rules:
              • ALL-CAPS the domain keywords: status names (OPEN, CLOSED, SUBMITTED),
                DMS names (ASPEN, INFINITY, EVEREST, IDEAL, TARGET), environments (QA, STAGING,
                PRODUCTION). End every title with the environment from the evidence.
              • Bracket a dealer id when relevant: [Dealer 99204001]
              • No "should", no question phrasing, no [Module] - [Feature] prefix.
              • One bug = one issue. If the evidence shows multiple distinct failures,
                pick the primary one for this title.
            Examples:
              POST opportunities returns 500 on QA environment
              Unable to submit deal on TARGET QA environment
              Invoice total is not calculating correctly on STAGING environment
              CLOSED deals are displaying as OPEN on TARGET QA environment [Dealer 99204001]

            ── severity ─────────────────────────────────────────────────
            Critical — data loss, security exposure, or a full feature/endpoint completely blocked.
            High     — core feature broken with no clean workaround.
            Medium   — feature works but produces incorrect or partial results.
            Low      — cosmetic/minor deviation that does not block any workflow.

            ── priority ─────────────────────────────────────────────────
            High   — blocks QA or production workflow immediately.
            Medium — impairs workflow but a workaround exists.
            Low    — minor, does not block any workflow.

            ── reproSteps ───────────────────────────────────────────────
            An ordered array of plain strings. Rules:
              • Step 1 MUST name the environment and dealer: e.g.
                "Navigate to the TargetDMS application on the QA environment for Dealer [dealer ID from the evidence]."
                or "Send a request to the TargetDMS API on the QA environment for Dealer [dealer ID from the evidence]."
              • One atomic action per step — never bundle two actions into one string.
              • Imperative, third-person: "Click the Submit button." not "You click Submit."
              • Each step is an action only — leave the broken result out; it belongs in observations.
              • Reference exact labels, routes, field names, and methods verbatim from the evidence.
              • The final step is the action that triggers the failure.

            ── expected ─────────────────────────────────────────────────
            A single definitive string describing the correct resolved state.
            Never use "should" — state it as fact: "The deal is submitted and appears in the deals list."
            For API bugs: "POST /endpoint returns 201 with the created resource."
            This becomes the acceptance line: "I know this bug is resolved when: <expected>"

            ── observations ─────────────────────────────────────────────
            An array of distinct facts — what actually happened. Rules:
              • One distinct technical signal per element — never bundle two facts into one string.
              • Definitive, not speculative: "Response status is 500 Internal Server Error."
              • For API failures: one bullet per failing request
                  "POST /api/.../deals returns 422 Unprocessable Entity."
              • For console errors: one bullet per unique error
                  "Console error: Cannot read properties of undefined (reading 'dealId')."
              • For UI failures: one bullet per visible symptom
                  "The Submit button remains disabled after all required fields are filled."
              • Include a "No <expected record> appears in the list/UI" bullet when an action
                that should create/update something silently fails.
              • Extract directly from consoleLogs and failedNetworkRequests in the evidence.

            ── suspectedModule ──────────────────────────────────────────
            The feature area most likely at fault, inferred from the URL and evidence.
            Example: "Deals", "Invoices", "Opportunities", "Customer Management".

            ── assignedTeam ─────────────────────────────────────────────
            null unless the evidence clearly indicates a responsible team.

            ═══════════════════════════════════════════════════════════════
            RESPONSE SHAPE (return ONLY this JSON, no markdown wrapper)
            ═══════════════════════════════════════════════════════════════
            {shape}

            ═══════════════════════════════════════════════════════════════
            EVIDENCE (redacted):
            ═══════════════════════════════════════════════════════════════
            {JsonSerializer.Serialize(evidence)}
            """;
    }
}
