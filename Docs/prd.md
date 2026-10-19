# PRD: QA Copilot — AI-Powered Bug Capture Extension

## Project Overview
QA Copilot is a Chrome MV3 browser extension paired with a .NET 8 ASP.NET Core backend that lets a QA engineer capture a bug in one click. It freezes the session, collects console logs, network HAR, screenshots, and user action steps, ships that evidence to the backend, runs it through Claude CLI to generate a structured bug report, presents an editable review form in a persistent tab, and on confirmation creates a fully-populated work item in Azure DevOps and posts an Adaptive Card notification to a Microsoft Teams channel.

## Created
- **Date:** 2026-08-11
- **Author:** Iffah Muzaffar

---

## Tasks

### PHASE S — Scaffolding

#### Task 1: Monorepo + docker-compose skeleton
- **ID:** T01
- **Description:** Create the `qa-copilot/` monorepo, `docker-compose.yml` (Postgres `pgvector/pgvector:pg16`), and `db/init.sql` (schema + `CREATE EXTENSION vector`).
- **File:** `qa-copilot/docker-compose.yml`, `qa-copilot/db/init.sql`
- **Acceptance Criteria:**
  - `docker compose up` brings Postgres up without errors
  - `init.sql` applies cleanly
  - `bug_reports` table exists with all required columns

#### Task 2: Extension skeleton loads unpacked
- **ID:** T02
- **Description:** Vite + `@crxjs/vite-plugin`, `manifest.json` (MV3, permissions incl. `debugger`/`tabCapture`/`offscreen`/`webNavigation`, `Ctrl+Shift+B` command, host `test-dms.targetdealer.com`).
- **File:** `qa-copilot/extension/manifest.json`, `qa-copilot/extension/vite.config.ts`
- **Acceptance Criteria:**
  - `npm run build` produces a loadable unpacked extension
  - Background service worker registers without errors
  - Keyboard shortcut `Ctrl+Shift+B` is registered

#### Task 3: Ralph harness scaffold
- **ID:** T03
- **Description:** Create `ralph/run-loop.sh`, `ralph/iteration-prompt.md`, `ralph/verify.sh`, and seed `progress.md`.
- **File:** `ralph/run-loop.sh`, `ralph/iteration-prompt.md`, `ralph/verify.sh`
- **Acceptance Criteria:**
  - `run-loop.sh` dry-runs without errors
  - Detects unchecked tasks
  - Honors the `STOP` file and `MAX_ITERS` guard

---

### PHASE 0 — Thin End-to-End Slice

#### Task 4: User-action collector (content script)
- **ID:** T04
- **Description:** Capture clicks, double-clicks, keyboard, dropdowns, checkboxes, uploads, navigation, and tab switches; emit ordered numbered repro steps; mask sensitive fields at capture.
- **File:** `qa-copilot/extension/src/content/UserActionCollector.ts`
- **Acceptance Criteria:**
  - Interacting with a page yields a numbered step list
  - Password/token/secret fields are shown as `[MASKED]`
  - Steps survive page navigations

#### Task 5: CDP debugger session
- **ID:** T05
- **Description:** Attach `chrome.debugger` 1.3; enable `Network`, `Runtime`, `Log`, `Page`; re-attach on navigation.
- **File:** `qa-copilot/extension/src/background/DebuggerSession.ts`
- **Acceptance Criteria:**
  - Attaching to the target tab produces CDP events
  - No monkeypatching of the page
  - Survives a navigation without losing events

#### Task 6: Console collector
- **ID:** T06
- **Description:** Collect errors, warnings, uncaught exceptions, and promise rejections with timestamp, stack, source file, and line number.
- **File:** `qa-copilot/extension/src/collectors/ConsoleNetworkCollector.ts`
- **Acceptance Criteria:**
  - Thrown exceptions appear with stack trace
  - Console.error/warn calls are captured
  - Source file and line number are included

#### Task 7: Screenshot collector
- **ID:** T07
- **Description:** Viewport screenshot via `captureVisibleTab`; full-page via CDP `Page.captureScreenshot` with `captureBeyondViewport`.
- **File:** `qa-copilot/extension/src/collectors/ScreenshotCollector.ts`
- **Acceptance Criteria:**
  - Both viewport PNG and full-page PNG are produced
  - Works in service worker context (no `screen` global)

#### Task 8: Capture controller + trigger (slice exit)
- **ID:** T08
- **Description:** `Ctrl+Shift+B` / popup button freezes the session, snapshots all collectors, and assembles a JSON evidence package locally.
- **File:** `qa-copilot/extension/src/background/CaptureController.ts`, `qa-copilot/extension/src/background/index.ts`
- **Acceptance Criteria:**
  - One click/shortcut produces a complete local evidence package
  - Package contains actions + screenshot + console logs
  - Capture status is broadcast to popup via `chrome.storage.session`

---

### PHASE 1 — Full Collectors + Redaction

#### Task 9: Session collector
- **ID:** T09
- **Description:** Capture URL, navigation history, browser/OS/resolution/viewport, time-on-page, logged-in user, and current module via `scripting.executeScript`.
- **File:** `qa-copilot/extension/src/collectors/SessionCollector.ts`, `qa-copilot/extension/src/collectors/NavigationLog.ts`
- **Acceptance Criteria:**
  - URL, browser, OS, and resolution are captured
  - Environment (Test/Dev/Prod) is detected from hostname
  - Dealer ID is extracted from URL path

#### Task 10: Environment collector
- **ID:** T10
- **Description:** Capture language, timezone, local/session storage, filtered cookies, feature flags, and roles.
- **File:** `qa-copilot/extension/src/collectors/EnvironmentCollector.ts`
- **Acceptance Criteria:**
  - localStorage and sessionStorage keys are captured
  - Cookies are filtered to relevant domains
  - Feature flags and roles included where available

#### Task 11: Network collector → HAR
- **ID:** T11
- **Description:** Build a HAR from CDP Network events; highlight failed requests (400/401/403/404/409/422/500).
- **File:** `qa-copilot/extension/src/collectors/ConsoleNetworkCollector.ts`, `qa-copilot/extension/src/background/HarBuilder.ts`
- **Acceptance Criteria:**
  - HAR is valid and parseable
  - Failed requests have `_failed: true` flag
  - All highlighted status codes are captured

#### Task 12: Offscreen rolling video buffer
- **ID:** T12
- **Description:** Offscreen document + `MediaRecorder`, bounded rolling window (3–5 min default 180s); persist only the preceding window.
- **File:** `qa-copilot/extension/src/offscreen/VideoBuffer.ts`
- **Acceptance Criteria:**
  - Buffer stays bounded (does not grow unbounded)
  - Capture yields only the trailing window
  - Transfer to service worker succeeds

#### Task 13: Redaction pipeline
- **ID:** T13
- **Description:** Mask sensitive fields, filter cookies, strip configured payload bodies, scrub PII; emit `redaction_report`; fail closed on throw.
- **File:** `qa-copilot/extension/src/redaction/RedactionPipeline.ts`
- **Acceptance Criteria:**
  - Known secrets never appear in the assembled package
  - `redaction_report` lists all removed items
  - Capture is aborted (not silently corrupted) if redaction throws

---

### PHASE 1b — Intake

#### Task 14: Evidence package + upload client
- **ID:** T14
- **Description:** TypeScript types for the evidence package; multipart upload with inline JSON for session/env/actions/console and blobs for screenshot/video/HAR.
- **File:** `qa-copilot/extension/src/shared/EvidencePackage.ts`, `qa-copilot/extension/src/shared/UploadClient.ts`
- **Acceptance Criteria:**
  - Multipart FormData is assembled correctly
  - Screenshots encoded as Blob without using `fetch("data:...")` (unreliable in service workers)
  - Upload returns `report_id`

#### Task 15: Backend scaffold + data layer
- **ID:** T15
- **Description:** .NET 8 Web API, EF Core + Npgsql, `bug_reports` table mapping with unique `capture_id` constraint.
- **File:** `qa-copilot/backend/Program.cs`, `qa-copilot/backend/Data/AppDbContext.cs`, `qa-copilot/backend/Data/BugReport.cs`
- **Acceptance Criteria:**
  - `dotnet build` succeeds with no errors
  - EF migrations create `bug_reports` with all columns
  - Unique constraint on `capture_id` is enforced

#### Task 16: Evidence intake endpoint (idempotent)
- **ID:** T16
- **Description:** `POST /api/evidence`: idempotent on `capture_id`; save file attachments to volume; serialize `session.json`, `console.json`, `environment.json`, and `actions.json` for the generate step.
- **File:** `qa-copilot/backend/Controllers/EvidenceController.cs`, `qa-copilot/backend/Evidence/VolumeEvidenceStore.cs`
- **Acceptance Criteria:**
  - Second upload of the same `capture_id` returns `DUPLICATE` without a new row
  - All four JSON evidence files are written to the volume
  - Screenshot and HAR blobs are saved with correct filenames (including extensions)

---

### PHASE 2 — AI Report + Review

#### Task 17: LLM provider (Claude CLI)
- **ID:** T17
- **Description:** Subprocess invocation of Claude CLI behind `ILlmProvider`; versioned, grounded, JSON-only prompt; logs latency per call. `PromptTemplate` (`Version = "v2"`) encodes the team's QA house style, ported from the existing api-bugger / buggy bug-format skills.
- **File:** `qa-copilot/backend/Llm/ClaudeCliLlmProvider.cs`, `qa-copilot/backend/Llm/PromptTemplate.cs`, `qa-copilot/backend/Llm/ILlmProvider.cs`
- **Acceptance Criteria:**
  - Sample evidence yields structured JSON draft
  - Latency is logged in milliseconds
  - Severity must be one of: Low, Medium, High, Critical
  - Priority must be one of: Low, Medium, High
  - Prompt classifies the bug as `API`, `UI`, or `Both`
  - Titles are declarative negative-state statements that ALL-CAPS domain keywords (status names, DMS names, environments) and end with the environment
  - Repro steps are env-first and atomic; `expected` is stated definitively (never "should")
  - `observations` carry one distinct technical signal per element
  - The prompt never asks for a suggested fix — the draft stops at observed facts and does not speculate about causes

#### Task 18: Generate endpoint
- **ID:** T18
- **Description:** `POST /api/reports/{id}/generate` → loads all evidence from volume (actions, session, console, HAR), **trims it down to an LLM-sized payload**, passes it to Claude, returns structured draft; idempotent for DRAFTED/EDITED/FILED status.
- **File:** `qa-copilot/backend/Controllers/ReportsController.cs`
- **Acceptance Criteria:**
  - Draft contains `title`, `bugType`, `severity`, `priority`, `reproSteps[]`, `expected`, `observations[]`, `suspectedModule`, and optional `assignedTeam`
  - `targetUrl`, `environment`, and `dealerId` are injected from session (not LLM-generated)
  - Calling generate on an already-drafted report returns the existing draft without re-running Claude
  - Evidence sent to the LLM is trimmed: `environment` reduced to feature flags + roles (raw localStorage/sessionStorage stripped), `session` reduced to url/environment/dealerId/browser/os/loggedInUser/currentModule, `consoleLogs` and `reproActions` capped at the last 50 entries each, `failedNetworkRequests` limited to status >= 400 and capped at 30
  - Full untrimmed evidence remains on the volume and is still what gets attached to ADO

#### Task 19: Review-before-file UI (persistent tab)
- **ID:** T19
- **Description:** Full-page React + MUI review tab opened via `chrome.tabs.create`; every field is editable; all edits auto-saved to `chrome.storage.local`; shows ENV chip, dealer ID, and captured URL; File Bug posts the edited draft.
- **File:** `qa-copilot/extension/src/review/review.tsx`, `qa-copilot/extension/src/review/index.html`
- **Acceptance Criteria:**
  - Tab stays open until user closes it manually (not a popup)
  - Edits persist if tab is backgrounded (auto-saved to `chrome.storage.local`)
  - ENV, Dealer ID, and URL are shown as read-only metadata
  - Error alert appears near the File Bug button (not scrolled away)
  - Editable fields match the draft shape: Title; Repro Steps (one per line); Expected; Observations (one per line); Suspected Module + Bug Type select (API/UI/Both); Severity + Priority + Assigned Team; File Bug

---

### PHASE 3 — Azure DevOps Push

#### Task 20: Inspect TargetDMS Bug field schema
- **ID:** T20
- **Description:** Confirm live TargetDMS project field requirements: Severity format, Priority format, area/iteration paths, required fields.
- **File:** `qa-copilot/backend/Ado/AdoRestClient.cs` (field mappings)
- **Acceptance Criteria:**
  - Severity uses "N - Label" format (e.g. "3 - Medium")
  - Priority is integer 1–4
  - AreaPath is `TargetDMS\TargetDMS`
  - IterationPath is `TargetDMS`

#### Task 21: ADO REST client
- **ID:** T21
- **Description:** Upload selected attachments to `_apis/wit/attachments` using the file's actual filename (with extension); create the Bug via JSON Patch. Builds the `ReproSteps` field as a single HTML document with four sections — Repro Steps, System Details, Network, Attachments — and attaches only `environment` as an `AttachedFile` relation.
- **File:** `qa-copilot/backend/Ado/AdoRestClient.cs`
- **Acceptance Criteria:**
  - `ReproSteps` is one HTML document with four headings in this exact order:
    1. **Repro Steps** — steps as a `<ul>`, followed by an `OBSERVATION:` sub-heading with observations as a `<ul>`
    2. **System Details** — table of DMS Dealer ID, Dealer ID, Environment, URL, Browser, OS, Logged-in User, plus Customer ID / Order ID only when found; missing values render as an em-dash
    3. **Network** — table of every captured HAR entry (Method / Status / URL), 4xx orange and 5xx red, `chrome-extension://` entries filtered out
    4. **Attachments** — screenshot embedded inline as an `<img>`
  - DMS Dealer ID is read from the environment file's `localStorage["persist:root"]` → `auth.dmsDealerId`
  - Browser is a friendly name parsed from the UA (e.g. "Chrome"); OS is a generic name from `navigator.platform` (e.g. "Windows")
  - Customer ID / Order ID are harvested from POST bodies in the captured network entries
  - Screenshot is uploaded with a `.png` extension to obtain an ADO URL, but is **not** added as an `AttachedFile` relation — it appears only embedded in the Attachments section
  - `actions`, `console`, `har`, `session`, and `video` are not uploaded at all; `environment` is the only `AttachedFile` relation, so the ADO Attachments tab holds exactly one file
  - ADO 203 (dedup) responses handled gracefully without throwing
  - Work item creation uses case-insensitive JSON deserialization
  - Failures log the raw ADO response body

#### Task 22: File endpoint
- **ID:** T22
- **Description:** `POST /api/reports/{id}/file`: persist edited draft as `EDITED`; create the ADO Bug from the full (untrimmed) evidence on the volume; set `FILED` on success and `FAILED` with `error_details` on error.
- **File:** `qa-copilot/backend/Controllers/ReportsController.cs`
- **Acceptance Criteria:**
  - One confirmed action creates a real bug in TargetDMS
  - `environment` is attached as the single `AttachedFile` relation
  - ADO Bug sets Title, AreaPath `TargetDMS\TargetDMS`, IterationPath `TargetDMS`, ReproSteps (four-section HTML), Severity as `"N - Label"`, Priority as int 1–4, ValueArea `Business`, AcceptanceCriteria "I know this bug is resolved when: &lt;expected&gt;", and SystemInfo (bug type, URL, environment, dealer, how-found)
  - ReproSteps carries the system details, the full captured network table, and the inline screenshot

---

### PHASE 4 — Notify + Harden

#### Task 23: Teams notifier
- **ID:** T23
- **Description:** Post an Adaptive Card to the Teams Power Automate webhook on successful filing; `BugNotification` carries `BugType` and `Observations string[]`. Card includes severity emoji, bug title, fact table (bug type/severity/priority/module/environment/dealer/team/ADO ID), captured URL, Expected, Observations joined with " | ", and an "Open in Azure DevOps" action button. Best-effort — never reverses a successful filing.
- **File:** `qa-copilot/backend/Teams/TeamsWebhookNotifier.cs`, `qa-copilot/backend/Teams/INotifier.cs`
- **Acceptance Criteria:**
  - Adaptive Card is sent with all fields populated
  - Teams message includes direct ADO work item link
  - Notifier failure does not affect the file response
  - No-op if webhook URL is not configured

#### Task 24: README & Architecture Doc
- **ID:** T24
- **Description:** Install/run extension + backend locally; ADO/Teams credential config; collector/architecture map; redaction/privacy approach; limitations; next steps.
- **File:** `qa-copilot/README.md`
- **Acceptance Criteria:**
  - A reviewer can follow the README to install the extension and run the backend
  - All configuration keys documented
  - Architecture and data flow described

#### Task 25: End-to-end rehearsal
- **ID:** T25
- **Description:** Verify the full flow: extension captures bug → evidence uploaded → Claude generates report → review tab opens → user edits → File Bug → ADO ticket created → Teams notification sent.
- **File:** All
- **Acceptance Criteria:**
  - Full acceptance checklist passes end-to-end
  - Debugger attaches when QA clicks Start Recording; re-attaches on full-page reload within the recording tab
  - Console errors and failed network requests appear in the generated report
  - ADO ticket has correct fields; ReproSteps renders all four sections (Repro Steps + OBSERVATION, System Details, Network, Attachments)
  - The screenshot renders inline in the ADO Attachments section via the embedded `<img>`; `environment` is the only file in the ADO Attachments tab
  - Generated draft follows the house style (bug type classified, ALL-CAPS keywords in title, definitive `expected`)

---

## Success Metrics

- Capture-to-filed flow completes in under 60 seconds (excluding Claude generation time)
- Console errors and failed API calls from the active session appear in the generated report
- Repro steps accurately reflect user actions performed before capture
- ADO work item contains all required fields with no placeholder values
- Screenshots are rendered inline in ADO (embedded as an `<img>` in the ReproSteps Attachments section, not as a download link or an attached file)
- The ADO ReproSteps field reads as a single document: Repro Steps + OBSERVATION, System Details, Network, Attachments
- Generated drafts match the team's QA house-style bug format (bug type, negative-state title, definitive expected, per-signal observations)
- ENV chip, Dealer ID, and captured URL are visible in the review form
- Teams channel receives an Adaptive Card with a working "Open in Azure DevOps" link
- Review tab persists edits across backgrounding
- Capturing the same session twice returns `DUPLICATE` without a duplicate ADO ticket
- Backend credentials are never committed to source control (live in `appsettings.Development.json` only)

---

## Notes

- The `.env` file and `appsettings.json` `${VAR}` placeholders are for Docker/CI only. Real local credentials go in `appsettings.Development.json` which is gitignored.
- The debugger must be attached **before** the bug is triggered — click **Start Recording** in the extension popup before reproducing the issue. This attaches the Chrome debugger, begins collecting console/network events, and injects the content scripts into the active tab. A green gear icon and "REC" badge confirm that recording is active. If you dismiss Chrome's "debugging this browser" infobar, recording stays active but CDP events pause until the next navigation.
- Claude CLI must be installed and authenticated on the host machine. The backend runs locally (not in Docker) so it can reach the CLI.
- ADO PAT requires **Work Items: Read, Write & Manage** scope on the `constellationdealer` organization.
- The review page opens in a new tab via `chrome.tabs.create`. The popup resets to idle immediately so the next capture is ready.
- The backend must run on port 8080 — the extension hardcodes `API_BASE = "http://localhost:8080"`, so the `backend` entry in `.claude/launch.json` sets `"autoPort": false`.
- Evidence sent to Claude is trimmed (see T18); the full evidence set is preserved on the volume for attachment to ADO.
