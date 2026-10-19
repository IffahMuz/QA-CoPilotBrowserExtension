# Progress: QA Copilot — AI-Powered Bug Capture Extension

## Overview
- **PRD:** prd.md
- **Started:** 2026-08-11
- **Status:** ✅ **COMPLETE**

---

## Task Progress

| Task ID | Task Name | Status | Started | Completed | Notes |
|---------|-----------|--------|---------|-----------|-------|
| T01 | Monorepo + docker-compose skeleton | ✅ COMPLETED | 2026-08-11 | 2026-08-11 | qa-copilot/ created, docker-compose.yml + db/init.sql with pgvector + bug_reports table |
| T02 | Extension skeleton loads unpacked | ✅ COMPLETED | 2026-08-11 | 2026-08-11 | npm run build passes, MV3 manifest with all permissions + Ctrl+Shift+B command |
| T03 | Ralph harness scaffold | ✅ COMPLETED | 2026-08-11 | 2026-08-11 | bash syntax passes, STOP + MAX_ITERS guards in place |
| T04 | UserActionCollector (content script) | ✅ COMPLETED | 2026-08-11 | 2026-08-11 | click/dblclick/change/key/file upload captured; SENSITIVE regex masks pass/token/secret |
| T05 | CDP DebuggerSession | ✅ COMPLETED | 2026-08-11 | 2026-08-11 | attach/reattach + event routing to collectors; attach on Start Recording + re-attach on tab reload; auto-stop on tab close |
| T06 | Console collector | ✅ COMPLETED | 2026-08-11 | 2026-08-11 | exceptionThrown/consoleAPICalled/Log.entryAdded with stack, source, line |
| T07 | Screenshot collector | ✅ COMPLETED | 2026-08-11 | 2026-08-11 | captureVisibleTab + CDP Page.captureScreenshot; fixed screen.width → tab.width for service worker |
| T08 | CaptureController + trigger | ✅ COMPLETED | 2026-08-11 | 2026-08-11 | Ctrl+Shift+B + popup CAPTURE_BUG; status broadcast via chrome.storage.session |
| T09 | SessionCollector + NavigationLog | ✅ COMPLETED | 2026-08-11 | 2026-08-11 | url/nav history/browser/os/resolution/viewport/timeOnPage/user/module; added environment detection + dealerId extraction |
| T10 | EnvironmentCollector + CookieProbe | ✅ COMPLETED | 2026-08-11 | 2026-08-11 | ls/ss/cookies(filtered)/flags/roles captured via scripting.executeScript |
| T11 | Network collector → HAR | ✅ COMPLETED | 2026-08-11 | 2026-08-11 | CDP Network events → HAR entries; _failed flag set for 400/401/403/404/409/422/500 |
| T12 | Offscreen rolling video buffer | ✅ COMPLETED | 2026-08-11 | 2026-08-11 | 1s timeslice, cutoff trim, offscreen.html wired; bounded rolling window |
| T13 | RedactionPipeline | ✅ COMPLETED | 2026-08-11 | 2026-08-11 | SECRET_KEY regex, PII scrub, auth body strip; fail-closed on throw |
| T14 | EvidencePackage + UploadClient | ✅ COMPLETED | 2026-08-11 | 2026-08-11 | Multipart FormData; fixed fetch("data:...") → dataUrlToBlob() for service worker reliability |
| T15 | Backend scaffold + data layer | ✅ COMPLETED | 2026-08-11 | 2026-08-11 | dotnet build passes; EF Core + Npgsql; bug_reports table with all columns |
| T16 | Evidence intake endpoint (idempotent) | ✅ COMPLETED | 2026-08-11 | 2026-08-11 | Duplicate check on capture_id; saves session.json + console.json + environment.json + actions.json to volume |
| T17 | ILlmProvider + ClaudeCliLlmProvider | ✅ COMPLETED | 2026-08-11 | 2026-08-11 | cmd.exe /c claude on Windows; Stopwatch latency log; JSON extract; constrained severity/priority values; PromptTemplate now v2 = QA house-style format (bug type, negative-state title, definitive expected, observations) |
| T18 | Generate endpoint | ✅ COMPLETED | 2026-08-11 | 2026-08-11 | Loads all evidence (actions, session, console, HAR failed requests) and trims it before the LLM call (env → flags+roles, session → key fields, last 50 console/actions, ≤30 requests with status ≥ 400); injects targetUrl/environment/dealerId from session after generation. Draft shape: title/bugType/severity/priority/reproSteps/expected/observations/suspectedModule |
| T19 | Review-before-file UI (persistent tab) | ✅ COMPLETED | 2026-08-11 | 2026-08-11 | Full-page tab via chrome.tabs.create; auto-save to chrome.storage.local; ENV chip + dealer + URL metadata bar; fields = Title / Repro Steps / Expected / Observations / Suspected Module + Bug Type / Severity + Priority + Assigned Team |
| T20 | Inspect TargetDMS Bug field schema | ✅ COMPLETED | 2026-08-11 | 2026-08-11 | Severity: "N - Label" format; Priority: int 1–4; AreaPath: TargetDMS\TargetDMS; IterationPath: TargetDMS |
| T21 | ADO REST client | ✅ COMPLETED | 2026-08-11 | 2026-08-11 | Path.GetFileName(path) for attachment filenames (.png extension); handles 203 dedup; case-insensitive JSON deserialization; logs raw ADO response on failure. ReproSteps now one HTML doc with 4 sections (Repro Steps + OBSERVATION, System Details, Network, Attachments); environment is the only AttachedFile relation, screenshot is embedded inline instead |
| T22 | File endpoint | ✅ COMPLETED | 2026-08-11 | 2026-08-11 | EDITED → FILED using the full untrimmed evidence on the volume; error alert placed near File Bug button; ADO fields = Title/AreaPath/IterationPath/ReproSteps/Severity/Priority/ValueArea/AcceptanceCriteria/SystemInfo |
| T23 | Teams notifier | ✅ COMPLETED | 2026-08-11 | 2026-08-11 | Adaptive Card with severity emoji, fact table (incl. Bug Type), captured URL, Expected + Observations (joined with " \| "), Open in ADO button; sent via Power Automate webhook |
| T24 | README & Architecture Doc | ✅ COMPLETED | 2026-08-11 | 2026-08-11 | qa-copilot/README.md: install/run, collector map, config reference, ADO field map, limitations |
| T25 | End-to-end rehearsal | ✅ COMPLETED | 2026-08-11 | 2026-08-11 | Full flow verified: capture → upload → Claude generates → review tab → edit → file → ADO ticket → Teams card |

---

## Summary
- **Total Tasks:** 25
- **Completed:** 25
- **In Progress:** 0
- **Not Started:** 0

---

## Log

### 2026-08-11
- Created PRD and Progress files; seeded all 25 tasks from solution.md/blueprint.md
- **PHASE S COMPLETE (T01–T03):** Monorepo, extension skeleton, ralph harness scaffolded
- **PHASE 0 COMPLETE (T04–T08):** UserActionCollector, DebuggerSession, console/screenshot collectors, CaptureController wired
- **PHASE 1 COMPLETE (T09–T13):** SessionCollector + NavigationLog, EnvironmentCollector, HAR builder, video buffer, redaction pipeline
- **PHASE 1b COMPLETE (T14–T16):** EvidencePackage types, UploadClient (fixed data: URL issue for service workers), backend scaffold + intake endpoint
- **PHASE 2 COMPLETE (T17–T19):** Claude CLI provider (Windows cmd.exe wrapper), generate endpoint (all evidence loaded), review tab (persistent, auto-save, metadata bar)
- **PHASE 3 COMPLETE (T20–T22):** ADO field schema confirmed, AdoRestClient with correct filename extensions + 203 dedup handling, file endpoint with improved error reporting
- **PHASE 4 COMPLETE (T23–T25):** Teams Adaptive Card notifier, README, end-to-end rehearsal
- **Key fixes applied during session:**
  - Debugger auto-attach on tab navigation (was only attaching at capture time — missed pre-capture events)
  - NavigationLog.init() call added (was never called)
  - `${ADO_PAT}` placeholder in appsettings.json does not expand — real credentials moved to appsettings.Development.json
  - ADO `ReadFromJsonAsync` case sensitivity fixed (ADO returns lowercase `url`; default options are case-sensitive)
  - Screenshots attach as `screenshot.png` (previously uploaded without extension — ADO wouldn't render inline)
  - CORS added to backend (chrome-extension:// origins blocked without it)
  - Console/network evidence was empty in generated report — fixed by loading all four JSON evidence files in generate endpoint
  - Environment (Test/Dev/Prod) and Dealer ID added to session, review form, ADO description, and Teams card
- **ALL TASKS COMPLETED** ✅

### 2026-08-12 — Post-completion enhancements
- **Recording lifecycle (Start/Stop Recording):** Replaced auto-attach-on-navigation with an explicit Start Recording / Stop Recording flow. Red gear icon (idle) → green gear + "REC" badge (recording). Recording state persisted in `chrome.storage.session` to survive service-worker eviction.
- **Chrome debugger infobar handling:** `chrome.debugger.onDetach` now checks the `reason` parameter. If `reason === "canceled_by_user"` (user dismissed the infobar), recording stays active without reattaching — CDP events resume on next full navigation. Any other reason triggers reattach.
- **Silent Issue Notifier (`SilentIssueNotifier.ts`):** New content script that listens for `SILENT_ERROR_DETECTED` messages from the background and renders a dark-themed toast in the page (Shadow DOM, `position:fixed`, `z-index:2147483647`). Toast has an expandable details panel (`max-height: calc(100vh - 155px)`), a **Capture Issue** button that sends `CAPTURE_BUG`, and a dismiss button. Background detects console errors via `DebuggerSession.maybeNotify` (dedup by `source:line`).
- **Content script re-injection on recording start:** `startRecording()` calls `chrome.scripting.executeScript` using file paths from `chrome.runtime.getManifest().content_scripts` to re-inject content scripts into the active tab. Necessary because already-open tabs do not receive new content scripts when the extension is reloaded. Double-injection guards (`window.__qacSilentLoaded`, `window.__qacActionsLoaded`) prevent duplicate listener registration.
- **SW eviction / `onEvent` listener loss fix:** `DebuggerSession.attach` now wraps the `chrome.debugger.attach` + `sendCommand` calls in `try/finally` and always calls `chrome.debugger.onEvent.addListener(DebuggerSession.onEvent)` in the `finally` block. Previously, if the SW was evicted and restarted while the debugger was already attached, `attach()` would throw "already attached" and the listener would never be re-registered in the new SW instance — CDP events fired into a void and no toasts appeared.

### 2026-08-12 — House-style bug format, ADO layout, and evidence trimming
- **QA house-style bug format integrated (from the api-bugger / buggy bug-format skills):** The team's existing bug-writing skills were ported into the pipeline end to end.
  - `BugReportDraft` reshaped to `Title`, `BugType` ("API" | "UI" | "Both"), `Severity`, `Priority`, `ReproSteps[]`, `Expected`, `Observations[]`, `SuspectedModule`, `AssignedTeam?`, `TargetUrl?`, `Environment?`, `DealerId?`. The old `actual`, `consoleErrorSummary`, `failedApiSummary`, and `environmentSummary` fields were removed.
  - `PromptTemplate` bumped to `Version = "v2"`: bug-type detection (API/UI/Both); declarative negative-state titles that ALL-CAPS domain keywords (status names, DMS names, environments) and end with the environment; env-first atomic repro steps; definitive `expected` (never "should"); `observations` as one distinct technical signal per element.
  - Review UI fields updated to match: Title; Repro Steps (one per line); Expected; Observations (one per line); Suspected Module + Bug Type select; Severity + Priority + Assigned Team; File Bug. The `actual` field and the three summary fields are gone.
  - `suggestedFix` dropped from the draft, prompt, review form, and ADO `SystemInfo`: proposing a fix is a developer judgement on server-side code the extension cannot observe, so the report stops at observed facts.
  - `BugNotification` now carries `BugType` and `Observations string[]` (no `Actual`); the Teams card FactSet includes Bug Type and the body shows Expected plus Observations joined with " | ".
- **ADO ReproSteps rebuilt as a four-section HTML document** (`AdoRestClient.cs`), in this order:
  1. **Repro Steps** — steps as a `<ul>`, then an `OBSERVATION:` sub-heading with observations as a `<ul>`.
  2. **System Details** — table of DMS Dealer ID, Dealer ID, Environment, URL, Browser, OS, Logged-in User, plus Customer ID / Order ID when found. DMS Dealer ID comes from the environment file's `localStorage["persist:root"]` → `auth.dmsDealerId`; Browser is a friendly name parsed from the UA ("Chrome") and OS a generic name from `navigator.platform` ("Windows"); missing values render as an em-dash.
  3. **Network** — table of every captured HAR entry (Method / Status / URL), 4xx orange and 5xx red, `chrome-extension://` entries filtered out. Customer ID / Order ID are harvested from POST bodies here.
  4. **Attachments** — screenshot embedded inline as an `<img>`.
- **Attachment policy changed:** of the manifest keys (`session`, `console`, `environment`, `actions` JSON; `har`, `screenshot`, `video` blobs), only two are uploaded. `environment` is the sole `AttachedFile` relation, so the ADO Attachments tab holds exactly one file. The screenshot *is* uploaded to obtain an ADO URL but is **not** made a relation — it appears only embedded in the ReproSteps Attachments section, so screenshots still render inline in ADO via the `<img>` rather than as an attachment. `actions`, `console`, `har`, `session`, and `video` are not uploaded at all, since the ReproSteps document already renders their content.
- **Evidence trimming before the LLM call (`ReportsController.Generate`):** raw localStorage/sessionStorage was pushing the prompt to ~76 KB and generation to ~52 s. Now `environment` is reduced to featureFlags + roles (storage stripped), `session` to url/environment/dealerId/browser/os/loggedInUser/currentModule, `consoleLogs` and `reproActions` to the last 50 entries each, and `failedNetworkRequests` to status >= 400 capped at 30 — a few KB instead of ~76 KB. Full untrimmed evidence is still stored on the volume, and the ADO bug still renders all of it: the ReproSteps Network table is built from the complete HAR, not from the trimmed projection.
- **`.claude/launch.json`:** the `backend` entry sets `"autoPort": false` because the extension hardcodes `API_BASE = "http://localhost:8080"`.
