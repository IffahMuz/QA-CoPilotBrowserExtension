# Worked Example: Ticket → Test Cases

A concrete model to match. The reference standard for title format, step granularity, and per-step expected results.

## Reference standard (the gold standard to match)

**Title:** `[Module] - [Feature] - Verify that <behavior>`
**Steps:** every atomic action is its own row; every row has an explicit expected result; the last row is the "Verify that..." check.

### Deals - Pipeline - Verify that user is able to switch to the newly created pipeline.

```
Preconditions: Dealer ID: 99204001 | Environment: QA

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Login to TargetCRM | User is logged in and the dashboard loads |
| 2 | Navigate to Settings | Settings page opens |
| 3 | Move to the Deals tab | Deals settings tab is displayed |
| 4 | Click on the Add Pipeline button | Add Pipeline form opens |
| 5 | Add at least one department | Department is added to the pipeline |
| 6 | Save the pipeline by clicking the SAVE button | Pipeline is saved and appears in the pipeline list |
| 7 | Navigate to the Deals module | Deals module opens |
| 8 | Click the "Select Pipeline" dropdown | Dropdown expands showing the list of pipelines |
| 9 | Click the newly created pipeline option | Pipeline is selected |
| 10 | Verify that the user switched to the pipeline successfully | The selected pipeline's stages load and the active pipeline reflects the new selection |
```
Actual Result:

Notice: 10 discrete actions = 10 steps. Navigating to Settings, moving to the Deals tab, and clicking Add Pipeline are **three separate steps**, never collapsed. Each has its own expected result.

---

## Example: defect ticket -> derived cases

**Source ticket #163561 - Unable to send message in FB conversation after 24 hours**
Module: Messenger / Feature: Facebook
Rule (from RULES.md): *FB messages only sendable within 24h of last customer inbound; after that a Human Agent tag is required.*

### Messenger - Facebook - Verify that user is able to send a message within the 24-hour window.

```
Preconditions: Dealer ID: 99204001 | Environment: QA | An FB conversation exists with a customer inbound message received < 24h ago

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Login to TargetCRM | User is logged in and the dashboard loads |
| 2 | Navigate to the Messenger module | Messenger opens and the conversation list is displayed |
| 3 | Locate the FB conversation with an inbound message less than 24 hours old | The conversation is visible in the list |
| 4 | Click the conversation to open it | The conversation thread opens and the message input field is enabled |
| 5 | Type a message in the input field | The typed text appears in the input field |
| 6 | Click the Send button | The message is sent and appears in the thread with a sent timestamp |
| 7 | Verify that the message was delivered within the 24-hour window | The message shows as sent/delivered in the conversation thread |
```
Actual Result:

### Messenger - Facebook - Verify that user is unable to send a standard message after the 24-hour window.

```
Preconditions: Dealer ID: 99204001 | Environment: QA | An FB conversation whose last customer inbound message is > 24h old

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Login to TargetCRM | User is logged in and the dashboard loads |
| 2 | Navigate to the Messenger module | Messenger opens and the conversation list is displayed |
| 3 | Locate the FB conversation with last inbound message older than 24 hours | The conversation is visible in the list |
| 4 | Click the conversation to open it | The conversation thread opens |
| 5 | Type a message in the input field | The typed text appears in the input field |
| 6 | Click the Send button | The message is not sent; the system indicates a Human Agent tag is required to message outside the 24-hour window |
| 7 | Verify that the standard message was blocked | No standard message is delivered and the 24-hour restriction is enforced |
```
Actual Result:

### Messenger - Facebook - Verify that user is able to send a message after 24 hours using the Human Agent tag.

```
Preconditions: Dealer ID: 99204001 | Environment: QA | FB conversation with last inbound > 24h ago

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Login to TargetCRM | User is logged in and the dashboard loads |
| 2 | Navigate to the Messenger module | Messenger opens and the conversation list is displayed |
| 3 | Locate and open the FB conversation with last inbound older than 24 hours | The conversation thread opens |
| 4 | Select the Human Agent tag option | The Human Agent tag is applied to the outgoing message |
| 5 | Type a message in the input field | The typed text appears in the input field |
| 6 | Click the Send button | The message is sent and appears in the thread |
| 7 | Verify that the message was delivered using the Human Agent tag | The message shows as sent/delivered outside the 24-hour window |
```
Actual Result:

### Messenger - SMS - Verify that an SMS conversation is not affected by the Facebook 24-hour rule.

```
Preconditions: Dealer ID: 99204001 | Environment: QA | An SMS (non-FB) conversation older than 24h

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Login to TargetCRM | User is logged in and the dashboard loads |
| 2 | Navigate to the Messenger module | Messenger opens and the conversation list is displayed |
| 3 | Locate and open an SMS conversation older than 24 hours | The conversation thread opens and the message input field is enabled |
| 4 | Type a message in the input field | The typed text appears in the input field |
| 5 | Click the Send button | The message is sent normally; the 24-hour restriction does not apply to SMS |
| 6 | Verify that the SMS sent without restriction | The message shows as sent/delivered with no Human Agent tag requirement |
```
Actual Result:

---

## What to notice

- **Title format**: `[Module] - [Feature] - Verify that <behavior>.` every time.
- **One rule -> multiple cases**: the 24h rule produced a happy path, an enforcement case, a recovery path, and a cross-flow guard (SMS). That spread is the coverage.
- **Childlike granularity**: opening a conversation = locate it (one step) + click it (next step). Typing and sending are separate steps. Nothing assumed.
- **Every step has a concrete expected result** - never blank, never bundled.
- **Ends on a "Verify that..." step** restating the title's behavior.
- **Exact labels**: "Send button", "Human Agent tag", "Messenger module" - verbatim.
- **Cross-flow case** (SMS) came from following the Touches link from Facebook -> Messenger SMS. Always check those links for impact cases.
