# QA Copilot

A two-part system that captures browser evidence, drafts a structured bug report with Claude CLI, and files it to Azure DevOps — with a human-in-the-loop review step before anything is sent.

---

## Architecture

```
Chrome (target tab)
  └─ content/UserActionCollector.ts   ← numbered repro steps, field masking
  └─ background/DebuggerSession.ts    ← CDP: Network / Runtime / Log / Page
  └─ offscreen/VideoBuffer.ts         ← rolling 3-min video (MediaRecorder)
  └─ background/CaptureController.ts  ← Ctrl+Shift+B → freeze → redact → upload
  └─ popup/ReviewScreen.tsx           ← edit draft, click File Bug

Backend (ASP.NET Core, Docker)
  └─ POST /api/evidence               ← idempotent intake, stores blobs to volume
  └─ POST /api/reports/{id}/generate  ← invokes Claude CLI, stores DRAFTED report
  └─ POST /api/reports/{id}/file      ← human confirms → files ADO bug + Teams notify

Infrastructure
  └─ PostgreSQL 16 + pgvector         ← report metadata, JSONB evidence index
  └─ Local volume (/evidence)         ← screenshot, video, HAR, console.json, environment.json
  └─ Claude CLI (host)                ← LLM subprocess, no cloud API key needed
  └─ Azure DevOps REST API            ← creates Bug work item with all 5 attachments
  └─ Teams webhook (optional)         ← posts module/severity/team on file
```

**Status lifecycle:** `RECEIVED → DRAFTED → EDITED → FILED` (or `FAILED` on ADO error)

---

## Prerequisites

| Tool | Version |
|------|---------|
| Docker Desktop | 4.x+ |
| Node.js | 18+ |
| .NET SDK | 8.0 |
| Claude CLI (`claude`) | latest |
| Chrome | 120+ |

---

## After a system restart — bring everything back up

Three services must be running before the extension can capture a bug. Start them in this order every time you restart your machine.

### Step 1 — Start Docker Desktop

Open **Docker Desktop** from the Start menu or taskbar. Wait until the whale icon in the system tray stops animating (engine is ready).

### Step 2 — Start Postgres

Open a terminal in `qa-copilot/` and run:

```bash
docker compose up -d postgres
```

Verify it is running:

```bash
docker ps --filter "name=qa-copilot-postgres"
```

You should see `Up X seconds/minutes` in the Status column.

### Step 3 — Start the backend

Open a terminal in `qa-copilot/backend/` and run:

```bash
dotnet run --urls http://localhost:8080 --environment Development
```

The backend starts on `http://localhost:8080`. Keep this terminal open — closing it stops the backend.

> Credentials (ADO PAT, Teams webhook, Postgres password) are read from `backend/appsettings.Development.json`. This file is gitignored and must stay on your machine.

### Step 4 — Reload the extension in Chrome

The extension itself stays installed across restarts. You only need to reload it if you rebuilt `dist/` since the last Chrome session:

1. Go to `chrome://extensions`
2. Find **QA Copilot** and click **Reload**

### Quick verify

Open `https://test-dms.targetdealer.com`. The extension icon should be active. Press **Ctrl+Shift+B** — if the popup appears and moves past "Uploading…" without an error, everything is connected.

---

## Quick start (first-time setup)

### 1. Configure secrets

Create `backend/appsettings.Development.json` (gitignored — never commit this):

```json
{
  "ConnectionStrings": {
    "Postgres": "Host=localhost;Port=5432;Database=qa_copilot;Username=postgres;Password=postgres"
  },
  "Evidence": { "Root": "C:\\qa-copilot-evidence" },
  "Llm": { "ClaudeCliPath": "claude" },
  "Ado": {
    "OrgUrl": "https://constellationdealer.visualstudio.com",
    "Project": "TargetDMS",
    "Pat": "<your ADO PAT — Work Items read/write scope>"
  },
  "Teams": {
    "WebhookUrl": "<Power Automate webhook URL, or leave blank to skip>"
  }
}
```

### 2. Start Postgres

```bash
cd qa-copilot
docker compose up -d postgres
```

Only Postgres runs in Docker. The backend runs on the host so it can call the `claude` CLI directly.

### 3. Start the backend

```bash
cd qa-copilot/backend
dotnet run --urls http://localhost:8080 --environment Development
```

### 4. Build and load the extension

```bash
cd qa-copilot/extension
npm install
npm run build
```

In Chrome:
1. Navigate to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select `extension/dist/`

The extension activates only on `https://test-dms.targetdealer.com/*`.

### 5. Capture a bug

1. Open a tab on `https://test-dms.targetdealer.com`
2. Reproduce the issue (all clicks/inputs are recorded from the moment the tab opens)
3. Press **Ctrl+Shift+B** (or click the extension icon → **Capture**)
4. A review tab opens → Claude generates a draft report
5. Edit any field, then click **File Bug**
6. A real Azure DevOps bug is created with all 5 attachments

---

## Collector map

| Collector | What it captures |
|-----------|-----------------|
| `UserActionCollector` | Clicks, inputs, dropdowns, uploads, key presses — numbered repro steps; sensitive fields masked at capture |
| `DebuggerSession` | CDP attach to tab; feeds Console and Network collectors |
| `ConsoleNetworkCollector` | Console errors/warnings with stack + source line; HAR with failed-request highlighting (400/401/403/404/409/422/500) |
| `ScreenshotCollector` | Viewport PNG (`captureVisibleTab`) + full-page PNG (`Page.captureScreenshot captureBeyondViewport`) |
| `VideoBuffer` | Rolling 3-min `MediaRecorder` window in offscreen document; only the trailing window is uploaded |
| `SessionCollector` | URL, nav history, browser/OS/resolution, time-on-page, logged-in user, current module |
| `EnvironmentCollector` | Language, timezone, localStorage/sessionStorage, filtered cookies, feature flags, roles |
| `RedactionPipeline` | Masks secret-looking storage keys, strips auth/token request bodies, scrubs PII (email/SSN) from URLs — **fail-closed** |

---

## Evidence package (5 attachments)

The ADO bug receives all five artifacts as `AttachedFile` relations:

| File | Contents |
|------|----------|
| `screenshot.png` | Full-page PNG at time of capture |
| `video.webm` | Rolling 3-min video buffer |
| `network.har` | HAR 1.2 with failed requests flagged |
| `console.json` | Console entries with stacks |
| `environment.json` | Storage, cookies, flags, roles |

---

## Redaction & privacy

All redaction runs **client-side in the browser before the package leaves Chrome**:

- Storage keys matching `/pass|token|secret|key|auth|ssn|card|cvv/i` are deleted
- Request/response bodies on `/auth|login|token/` endpoints are stripped
- PII patterns (email, SSN) are replaced with `[redacted]` in URLs
- `httpOnly` and `secure` cookies are excluded from capture
- A `redaction_report` (field names only, never values) is included in every package

---

## Configuration reference

**`backend/appsettings.json`** — non-secret defaults committed; secrets injected via environment:

| Key | Description |
|-----|-------------|
| `ConnectionStrings:Postgres` | Postgres connection string (overridden by `docker-compose.yml`) |
| `Evidence:Root` | Volume mount path for evidence blobs (default `/evidence`) |
| `Llm:ClaudeCliPath` | Path to `claude` binary (default `claude`, assumed on `PATH`) |
| `Ado:OrgUrl` | Azure DevOps org URL (e.g. `https://constellationdealer.visualstudio.com`) |
| `Ado:Project` | ADO project name (e.g. `TargetDMS`) |
| `Ado:Pat` | PAT with Work Items read/write — **inject via `ADO_PAT` env var** |
| `Teams:WebhookUrl` | Incoming webhook URL — optional, no-op if blank |

---

## ADO field mapping (TargetDMS)

The `AdoRestClient` uses standard ADO process-template fields. Confirm these against the live project after T20:

| Draft field | ADO field path | Notes |
|-------------|---------------|-------|
| Title | `System.Title` | required |
| Repro steps | `Microsoft.VSTS.TCM.ReproSteps` | HTML |
| Severity | `Microsoft.VSTS.Common.Severity` | `"1 - Critical"` / `"2 - High"` / `"3 - Medium"` / `"4 - Low"` |
| Priority | `Microsoft.VSTS.Common.Priority` | integer: High→1, Medium→2, Low→3, default→4 |
| Description | `System.Description` | expected, actual, console, failed APIs, environment, module |
| Area path | `System.AreaPath` | `TargetDMS\TargetDMS` |
| Iteration path | `System.IterationPath` | `TargetDMS` (root); sprints: Iteration 1/2/3 |
| — | `Custom.Developer` | available; not currently set by QA Copilot |
| — | `Custom.QA` | available; not currently set by QA Copilot |

---

## LLM provider

`ClaudeCliLlmProvider` invokes `claude -p --output-format text` as a subprocess, pipes the grounded prompt on stdin, and parses the first JSON object from stdout. The prompt (`PromptTemplate.cs v1`) supplies only the redacted evidence and forbids the model from using parametric memory.

To swap providers: implement `ILlmProvider` and re-register in `Program.cs`. No controller code changes.

---

## Limitations & known behaviours

- **Console/network data requires time** — the debugger attaches as soon as a target tab opens and accumulates data from that point. If you trigger a capture immediately after opening the tab, the console error summary and failed API summary may be sparse. Let the page settle and reproduce the issue before capturing.
- **Duplicate detection** — pgvector is installed but embedding search before filing is not wired (deferred per spec §4.7)
- **Area/iteration path** — not set on the ADO bug; can be added to `AdoRestClient.cs` after confirming sprint paths in the live project
- **Video upload size** — large captures may exceed multipart limits; tune `Kestrel:Limits:MaxRequestBodySize` in `appsettings.json`
- **Re-file after FAILED** — retry by re-posting to `/api/reports/{id}/file` with the same or edited draft

---

## Project structure

```
qa-copilot/
├── docker-compose.yml
├── db/init.sql                    # pgvector + bug_reports schema
├── extension/                     # TypeScript MV3
│   ├── manifest.json
│   ├── vite.config.ts
│   └── src/
│       ├── background/            # service worker, CaptureController, DebuggerSession
│       ├── offscreen/             # VideoBuffer (MediaRecorder)
│       ├── content/               # UserActionCollector
│       ├── collectors/            # Session, Environment, Console/Network, Screenshot
│       ├── redaction/             # RedactionPipeline
│       ├── shared/                # EvidencePackage types, UploadClient
│       └── popup/                 # ReviewScreen (MUI editable draft)
└── backend/                       # .NET 8 ASP.NET Core
    ├── Program.cs
    ├── Controllers/               # EvidenceController, ReportsController
    ├── Data/                      # AppDbContext, BugReport entity
    ├── Evidence/                  # IEvidenceStore, VolumeEvidenceStore
    ├── Llm/                       # ILlmProvider, ClaudeCliLlmProvider, PromptTemplate
    ├── Ado/                       # IAdoClient, AdoRestClient
    └── Teams/                     # INotifier, TeamsWebhookNotifier
```
