---
name: buggy
description: Write test cases for TargetCRM (ConstellationDealer) tickets in Mahmood Ahmad's QA style and push them into Azure DevOps. Use this skill WHENEVER the user asks to write, draft, generate, or create test cases for a TargetCRM ticket, defect, bug, or user story — or mentions a work item ID and testing, a Test Plan/Suite, test steps, expected/actual results, or QA verification on the Ideal Agile project. Trigger it even if the user only says "write tests for #169293" or "I need test cases for this story," and also when they paste a ticket description or flow doc and ask how to test it.
---

# TargetCRM Test Case Authoring

Write test cases the way Mahmood (QA→BA on TargetCRM) writes them: precise, behavior-driven, no ceremony — then create them as Test Case work items in Azure DevOps and link them to the source ticket.

## Context you can assume (from project memory)

- **Org:** constellationdealer · **Project:** Ideal Agile (ID `af3343be-7762-4c0e-ad1f-157f66a850d9`)
- **Boards:** Target SWAT (#30, production defects) and CRM Team (#44, sprint/feature work)
- **Test Plan:** planId=57868 · suiteId=57869
- **Author identity:** Mahmood Ahmad (`mahmood.ahmad@constellationdealer.com`)
- **Flow docs** (if the user built them): a folder of linked Markdown — `README.md` (index/mindmap), `RULES.md` (business-rule registry), `modules/*.md`, `integrations/*.md`. These are the source of truth for behavior; read the relevant module file + its linked neighbors + the cited RULES anchors before writing.

## The workflow

1. **Read the ticket.** Pull the work item with `azure-devops:list_work_items` (WIQL by ID) or have the user paste it. Extract: the dealer/environment, the feature touched, expected vs actual behavior, and any acceptance criteria.
2. **Scope the behavior.** If flow docs exist, open the module the ticket touches, follow its `Touches:` links, and collect every cited rule from `RULES.md`. If no docs, ask the user for the flow or work from the ticket + domain knowledge.
3. **Draft the test cases** in the format below. Cover happy path, every business rule, every edge case ("Breaks"), and negative/permission cases. The rules and edge cases are where the real coverage lives.
4. **Show the user the drafts for approval** before creating anything in ADO.
5. **Create each as a Test Case work item** (see "Creating in ADO").
6. **Link each to the source ticket.**
7. **Tell the user the new Test Case IDs** and remind them to add them to suite 57869 in the ADO Test Plans UI (Add existing test cases by ID) — that step is manual.

## Test case format

Each test case is one work item. Title and steps follow Mahmood's house style.

**Title:** ALWAYS `[Module] - [Feature] - Verify that <expected behavior>`

The third segment is phrased as "Verify that..." describing the specific behavior under test. Examples:
- `Deals - Pipeline - Verify that user is able to switch to the newly created pipeline.`
- `Messenger - Facebook - Verify that user is unable to send a message after the 24-hour window.`
- `Customers - Merge - Verify that a Facebook customer can be merged into an existing DMS customer.`

Mirror the dealer-bracket convention when the ticket is dealer-specific: `[Module] - [Feature] - Dealer Name [ID] - Verify that ...`.

**Steps — childlike granularity is mandatory.** Write every single click, navigation, and field entry as its own step. Never collapse "Navigate to Settings → Deals tab → Add Pipeline" into one step — that's three steps. Assume the tester knows nothing and must be guided action-by-action. If a flow has 10 discrete actions, there are 10 steps. The final step is always the verification step ("Verify that ...").

**Every step has its own explicit Expected Result.** No step is left without one. The expected result states exactly what the system shows or does in response to that one action — the screen that loads, the button that appears, the field that becomes editable, the message that displays.

ALWAYS use this exact step shape:

```
Preconditions: Dealer ID: <id> | Environment: <QA/Staging/Production> | <any setup state>

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Login to TargetCRM | User is logged in and the dashboard loads |
| 2 | Navigate to Settings | Settings page opens |
| 3 | Move to the Deals tab | Deals settings tab is displayed |
| 4 | Click on the Add Pipeline button | Add Pipeline form/drawer opens |
| 5 | Add at least one department | Department is added to the pipeline |
| 6 | Save the pipeline by clicking the SAVE button | Pipeline is saved and appears in the pipeline list |
| 7 | Navigate to the Deals module | Deals module opens |
| 8 | Click the "Select Pipeline" dropdown | Dropdown expands showing the list of pipelines |
| 9 | Click the newly created pipeline option | Pipeline is selected |
| 10 | Verify that the user switched to the pipeline successfully | The selected pipeline's stages/columns load and the active pipeline reflects the new selection |
```

Match the depth of the example above: one atomic action per row, each with a concrete expected result, ending on an explicit "Verify that ..." row.

**Actual Result:** leave a labeled line `Actual Result:` for the tester to fill during execution (Mahmood records actual results at run time, not at authoring time).

## Voice rules (this is what makes them read as Mahmood's)

- **Imperative, third-person, declarative.** "Open the Messenger module", "Click the SAVE button". Not "You should..." or "We will...".
- **Exact labels.** Use the real names: "Connect to Customer", "Social Channels column", "Select Pipeline dropdown", "@amountOwed merge tag", "snackbar". If the ticket names a field or button, use that string verbatim.
- **Childlike granularity.** Every click and navigation is its own step. Never bundle actions. A real test case for a 10-action flow has 10 rows. This is the single most important style trait — match the reference depth exactly.
- **Every step has an expected result.** No blank expected results, ever. Each row states the concrete observable response to that one action.
- **One assertion per step.** Don't bundle three checks into one expected result — split them so a failure points to one place.
- **End on a verification step.** The last row is always "Verify that <the behavior in the title>" with the definitive expected result.
- **No ceremony.** No greetings, no "Happy testing", no emojis, no "Verified ✅". Concise.
- **No hedging.** Expected results are definite ("the SAVE button is disabled"), never "should probably" or "might".

## Coverage checklist (derive cases from these)

For any ticket, produce cases across these axes — skip an axis only if it genuinely doesn't apply:

- **Happy path** — the primary success flow stated in the ticket.
- **Each business rule** — one case per rule in the relevant `RULES.md` entries (e.g. "FB messages only sendable within 24h", "one FB page per department", "auto-survey respects open hours").
- **Edge cases** — every "Breaks" item in the flow doc, plus boundaries (empty, max length, expired token, duplicate, deleted/merged records).
- **Negative cases** — invalid input, wrong state, action attempted when it shouldn't be allowed.
- **Permissions** — if the module is role-gated, verify each role sees/can-do the right thing.
- **Cross-flow impact** — for each `Touches:` link, a case that confirms the connected flow still behaves (e.g. a Payments change that must not break Messenger).

## Creating in ADO

Create each test case as a work item:

```
azure-devops:create_work_item
  workItemType: "Test Case"
  title: "<title per format above>"
  projectId: "Ideal Agile"
  areaPath: <SWAT or CRM Team area, matching the source ticket>
  assignedTo: "mahmood.ahmad@constellationdealer.com"   # unless told otherwise
  additionalFields:
    "Microsoft.VSTS.TCM.Steps": "<steps as HTML — see references/ado-steps-format.md>"
    "System.Tags": "<carry over relevant tags: QA; FB Integration; Production; etc.>"
```

The Steps field uses a specific ADO XML/HTML format, not plain text or a Markdown table. **Read `references/ado-steps-format.md` before writing the Steps field** — getting the markup right is what makes steps render as proper test steps in ADO.

Then link to the source ticket:

```
azure-devops:manage_work_item_link
  operation: "add"
  relationType: "Microsoft.VSTS.Common.TestedBy-Reverse"   # test case tests the ticket
  sourceWorkItemId: <source ticket ID>
  targetWorkItemId: <new test case ID>
```

If that relation type is rejected, fall back to `System.LinkTypes.Related` and tell the user the link is "Related" rather than "Tested By".

## Hard limits (be honest about these)

- **Cannot add test cases to a Test Suite via API** — no suite tool is available. After creating the cases, the user adds them to suite 57869 manually in the Test Plans UI. Always state the new IDs so this is quick.
- **Cannot execute test runs or record pass/fail outcomes** — authoring only.
- **Always get approval before creating** work items in ADO; creation is a real write.

## Quick example

See `references/example-testcases.md` for a worked example: a ticket → the test cases derived from it in full house style. Read it when you want a concrete model to match.
