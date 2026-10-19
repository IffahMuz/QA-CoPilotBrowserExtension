# QA Copilot — Complete User Guide

This guide walks through every step of using QA Copilot: from first-time setup through capturing a bug, verifying it was stored in the database, and confirming the Azure DevOps ticket was created correctly.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [First-Time Setup](#2-first-time-setup)
3. [After a System Restart — Quick Checklist](#3-after-a-system-restart--quick-checklist)
4. [Starting the Backend](#4-starting-the-backend)
5. [Building and Loading the Extension](#5-building-and-loading-the-extension)
6. [Capturing a Bug](#6-capturing-a-bug)
7. [Silent Issue Notifier](#7-silent-issue-notifier)
8. [Reviewing and Filing the Bug](#8-reviewing-and-filing-the-bug)
9. [Database Verification](#9-database-verification)
10. [Azure DevOps Ticket Verification](#10-azure-devops-ticket-verification)
11. [Teams Notification](#11-teams-notification)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Prerequisites

Make sure the following are installed before starting:

| Tool | How to verify |
|------|--------------|
| Docker Desktop (running) | `docker --version` |
| Node.js 18+ | `node --version` |
| .NET 8 SDK | `dotnet --version` |
| Google Chrome | Version 120 or newer |
| Claude CLI | `claude --version` |

Also required:
- An **Azure DevOps PAT** with **Work Items (Read & Write)** scope for `constellationdealer.visualstudio.com`
- (Optional) A **Teams incoming webhook URL**

---

## 2. First-Time Setup

### 2a. Clone / locate the project

All files live under:
```
qa-copilot/
```

### 2b. Create your credentials file

Credentials live in `qa-copilot/backend/appsettings.Development.json` (gitignored — never commit this file). If it does not exist yet, create it:

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
    "Pat": "<your Azure DevOps PAT — Work Items read/write scope>"
  },
  "Teams": {
    "WebhookUrl": "<Power Automate webhook URL, or leave blank to skip>"
  }
}
```

> **Never commit `appsettings.Development.json` to source control.** It is git-ignored. Do not put credentials in `appsettings.json` — the `${VAR}` placeholder syntax does not expand in .NET configuration.

---

## 3. After a System Restart — Quick Checklist

Every time you restart your machine, start these three things in order before using the extension.

### Step 1 — Start Docker Desktop

Open **Docker Desktop** from the Start menu or taskbar. Wait until the whale icon in the system tray stops animating — the engine is ready when it is still.

### Step 2 — Start Postgres

Open a terminal in `qa-copilot/` and run:

```bash
docker compose up -d postgres
```

Only Postgres runs in Docker. Verify it is up:

```bash
docker compose ps
```

Expected:
```
NAME                    STATUS
qa-copilot-postgres-1   Up X seconds
```

### Step 3 — Start the backend

Open a terminal in `qa-copilot/backend/` and run:

```bash
dotnet run --urls http://localhost:8080 --environment Development
```

Keep this terminal open — closing it stops the backend. You should see:
```
Now listening on: http://localhost:8080
Application started.
```

### Step 4 — Reload the extension (only if you rebuilt since last session)

If you ran `npm run build` since Chrome was last open:
1. Go to `chrome://extensions`
2. Click the **Reload** button (↺) on the QA Copilot card

### Quick verify

Open `https://test-dms.targetdealer.com`. Click the QA Copilot toolbar icon (red gear) → **▶ Start Recording**. The icon turns green. Navigate around the page, then click **Capture Bug**. If the review tab opens and shows a draft report, everything is connected.

---

## 4. Starting the Backend

> On a fresh system start, follow the [restart checklist](#3-after-a-system-restart--quick-checklist) above instead of this section. This section covers first-time startup only.

The backend (`dotnet run`) runs on your machine and calls the `claude` CLI directly. Only Postgres runs in Docker.

### Start Postgres

```bash
cd qa-copilot
docker compose up -d postgres
```

### Start the backend

```bash
cd qa-copilot/backend
dotnet run --urls http://localhost:8080 --environment Development
```

The backend reads credentials from `appsettings.Development.json`. Keep the terminal open.

### Verify the database schema was created

```bash
docker compose exec postgres psql -U postgres -d qa_copilot -c "\d bug_reports"
```

Expected output — you should see all columns:

```
      Column       |           Type
-------------------+--------------------------
 id                | bigint
 capture_id        | uuid
 created_at        | timestamp with time zone
 updated_at        | timestamp with time zone
 status            | character varying(20)
 target_url        | text
 module            | character varying(255)
 severity          | character varying(20)
 priority          | character varying(20)
 draft_report      | jsonb
 edited_report     | jsonb
 ado_work_item_id  | bigint
 evidence_manifest | jsonb
 error_details     | text
```

### Verify the backend API is responding

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/evidence
```

Expected: `405` (Method Not Allowed — GET is correct, only POST is accepted)

---

## 5. Building and Loading the Extension

### 5a. Build

```bash
cd qa-copilot/extension
npm install
npm run build
```

> Always use `npm run build` (production build). Never load a dev build — it causes popup blinking.

### 5b. Load in Chrome

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle top-right)
3. Click **Load unpacked**
4. Navigate to and select: `qa-copilot/extension/dist/`
5. The **QA Copilot** card appears — confirm it shows no errors

> The extension only activates on `https://test-dms.targetdealer.com/*`. On all other domains, the popup opens but capture is limited.

### 5c. Rebuild after any code change

```bash
cd qa-copilot/extension
npm run build
```

Then in `chrome://extensions`, click the **Reload** button (↺) on the QA Copilot card.

---

## 6. Capturing a Bug

### Step 1 — Navigate to the target site

Go to `https://test-dms.targetdealer.com` and log in with your credentials.

### Step 2 — Start Recording

Click the **QA Copilot** toolbar icon (red gear). The popup opens showing **▶ Start Recording**.

Click **▶ Start Recording**.

- The gear icon turns **green** and shows a **REC** badge
- The popup now shows "Capture Bug" and "■ Stop Recording"
- Chrome briefly shows a bar: *"QA Copilot started debugging this browser"* — you can dismiss it; recording stays active

> Recording must be active before you reproduce the issue. Nothing is captured while the icon is red.

### Step 3 — Reproduce the issue

Interact normally with the page. While recording is active, the extension silently collects:

| Your action | What gets captured |
|-------------|-------------------|
| Click a button | `1. Click "Save Order"` |
| Type into a field | `2. Set "Search" = work order` |
| Change a dropdown | `3. Select "Status" = Closed` |
| A console error fires | Logged with stack trace and source line |
| An API call fails (4xx/5xx) | Captured in the HAR with `_failed: true` flag |
| Password/token field changes | `4. Set "Password" = ••••• (masked)` |

### Step 4 — Trigger capture

When the bug is on screen, press **Ctrl+Shift+B** — or open the popup and click **Capture Bug**.

> The Ctrl+Shift+B shortcut only works while recording is active (green icon).

The popup shows live progress:

```
Freezing session…               ← collecting all evidence
Uploading evidence…             ← sending to backend
Generating report with Claude…  ← Claude CLI drafting the bug report
```

A new **Review tab** opens automatically when the draft is ready.

> If you see an error at any stage, see [Troubleshooting](#12-troubleshooting).

### Step 5 — Stop Recording (optional)

When you are done testing, open the popup and click **■ Stop Recording**. The icon returns to red. You can start a new recording session at any time.

---

## 7. Silent Issue Notifier

While recording is active, QA Copilot watches the browser's console in real time. If a `console.error`, uncaught exception, or unhandled promise rejection occurs on the page, a toast notification slides in from the bottom-right corner — even if you are not actively watching the console.

### Toast layout

```
┌─────────────────────────────────────────┐
│ ⚠️  Silent Issue Detected           [✕] │
│  We detected a console error that may   │
│  indicate an issue.                     │
│─────────────────────────────────────────│
│ [View Details]          [Capture Issue] │
└─────────────────────────────────────────┘
```

### Actions

| Button | What it does |
|--------|-------------|
| **View Details** | Expands the toast to show the full error message and source file/line. Click again to collapse. |
| **Capture Issue** | Immediately triggers a full bug capture (same as Ctrl+Shift+B) and dismisses the toast. |
| **✕** (top-right) | Dismisses the toast without capturing. |

### Deduplication

The same error message is shown at most once every 60 seconds. Repeated identical errors do not spam the screen.

### Notes

- The notifier only fires while recording is active (green icon).
- It is suppressed during an active capture so it does not interrupt the capture flow.
- The toast only appears on `https://test-dms.targetdealer.com/*` — the content script is not injected on other domains.

---

## 8. Reviewing and Filing the Bug

Once Claude finishes generating the draft, a new **Review tab** opens automatically in Chrome:

### What you see

| Field | What it contains |
|-------|-----------------|
| **Title** | Claude's suggested bug title |
| **Repro steps** | Numbered steps from your actual actions |
| **Expected** | What should have happened |
| **Actual** | What actually happened |
| **Console summary** | Errors/warnings with stack traces |
| **Failed API summary** | 4xx/5xx requests highlighted |
| **Environment summary** | Browser, OS, screen size, URL, user |
| **Suspected module** | Module Claude inferred from the page |
| **Severity** | Suggested: Low / Medium / High / Critical |
| **Priority** | Suggested: Low / Medium / High |
| **Assigned team** | Optional — fill in if known |

### Edit before filing

Every field is editable. Fix anything Claude got wrong — repro steps, severity, title — before filing.

### Click File Bug

When satisfied, click **File Bug**. This:
1. Persists your edited version to the database (`EDITED` status)
2. Creates the ADO work item with all 5 attachments
3. Posts a Teams notification (if configured)
4. Shows: `Filed ADO bug #XXXX — open`

---

## 9. Database Verification

After filing, verify the record was saved correctly.

### Connect to the database

```bash
docker compose exec postgres psql -U postgres -d qa_copilot
```

### Check the most recent bug report

```sql
SELECT
  id,
  capture_id,
  status,
  target_url,
  module,
  severity,
  priority,
  ado_work_item_id,
  created_at
FROM bug_reports
ORDER BY created_at DESC
LIMIT 5;
```

**Expected output after a successful filing:**

```
 id | capture_id                           | status | target_url                          | module       | severity   | priority | ado_work_item_id
----+--------------------------------------+--------+-------------------------------------+--------------+------------+----------+-----------------
  1 | 3f8a1c2d-...                         | FILED  | https://test-dms.targetdealer.com/  | Work Orders  | 3 - Medium | 2        | 12345
```

### Status meanings

| Status | Meaning |
|--------|---------|
| `RECEIVED` | Evidence uploaded, generation not yet run |
| `DRAFTED` | Claude generated a draft, awaiting review |
| `EDITED` | Human confirmed the report, about to file |
| `FILED` | ADO bug created successfully |
| `FAILED` | ADO/Teams call failed after confirm — see `error_details` |

### Inspect the AI-generated draft

```sql
SELECT draft_report
FROM bug_reports
ORDER BY created_at DESC
LIMIT 1;
```

Returns the raw JSON Claude produced, for example:

```json
{
  "title": "502 Bad Gateway on Order Save",
  "reproSteps": [
    "1. Navigate to Work Orders",
    "2. Open order c4cf2b83-...",
    "3. Click Save"
  ],
  "expected": "Order saves successfully",
  "actual": "POST /api/v1/Order/c4cf2b83-... returns 502 Bad Gateway",
  "consoleErrorSummary": "POST https://test-dms-api.targetdealer.com/api/v1/Order/c4cf2b83-1e4a-4f89-b3da-82df1ad411cd 502 (Bad Gateway)",
  "failedApiSummary": "POST /api/v1/Order — 502 Bad Gateway",
  "environmentSummary": "Chrome 120, Windows 11, 1920x1080, user: qa.tester@...",
  "suspectedModule": "Work Orders",
  "severity": "Medium",
  "priority": "High",
  "assignedTeam": null
}
```

### Inspect the human-edited version

```sql
SELECT edited_report
FROM bug_reports
ORDER BY created_at DESC
LIMIT 1;
```

This is what was actually filed to ADO — your edits override the draft.

### Check what evidence files were saved

```sql
SELECT evidence_manifest
FROM bug_reports
ORDER BY created_at DESC
LIMIT 1;
```

Returns the file paths on the evidence volume:

```json
{
  "package": "/evidence/3f8a1c2d-.../package",
  "har": "/evidence/3f8a1c2d-.../network.har",
  "screenshot": "/evidence/3f8a1c2d-.../screenshot.png",
  "video": "/evidence/3f8a1c2d-.../video.webm",
  "console": "/evidence/3f8a1c2d-.../console.json",
  "environment": "/evidence/3f8a1c2d-.../environment.json"
}
```

### Check counts by status (health overview)

```sql
SELECT status, COUNT(*) AS count
FROM bug_reports
GROUP BY status
ORDER BY status;
```

### Check for any failed filings

```sql
SELECT id, capture_id, error_details, created_at
FROM bug_reports
WHERE status = 'FAILED'
ORDER BY created_at DESC;
```

### Exit psql

```sql
\q
```

---

## 10. Azure DevOps Ticket Verification

After a successful filing, verify the ticket in Azure DevOps.

### 10a. Find the ticket via the link

The popup shows:
```
Filed ADO bug #12345 — open
```

Click **open** — it takes you directly to the ticket at:
```
https://constellationdealer.visualstudio.com/TargetDMS/_workitems/edit/12345
```

### 10b. What to check on the ticket

| ADO Field | Expected value |
|-----------|---------------|
| **Work Item Type** | Bug |
| **Title** | Your edited title from the review screen |
| **State** | New |
| **Area** | TargetDMS\TargetDMS |
| **Repro Steps** | Numbered steps from the review screen |
| **Severity** | Matches the severity you selected (e.g. `3 - Medium`) |
| **Priority** | Integer matching your selection (1=High, 2=Medium, 3=Low) |
| **Description** | Contains Expected, Actual, Console summary, Failed APIs, Environment, Module |
| **Attachments** | 5 files attached (see below) |

### 10c. Verify all 5 attachments

Click the **Attachments** tab on the work item. You should see:

| Filename | Contents |
|----------|----------|
| `screenshot.png` | Full-page screenshot of the page at capture time |
| `video.webm` | Rolling 3-minute screen recording ending at capture |
| `network.har` | All network requests in HAR 1.2 format |
| `console.json` | All console errors/warnings with stack traces |
| `environment.json` | localStorage, cookies, feature flags, browser info |

> If any attachment is missing, check `error_details` in the database for the failure reason.

### 10d. Verify via ADO REST API (optional)

Get the work item ID from the database first:

```bash
docker compose exec postgres psql -U postgres -d qa_copilot \
  -c "SELECT ado_work_item_id FROM bug_reports WHERE status='FILED' ORDER BY created_at DESC LIMIT 1;"
```

Then query ADO directly (replace `WORK_ITEM_ID`):

```bash
curl -s -u ":$ADO_PAT" \
  "https://constellationdealer.visualstudio.com/TargetDMS/_apis/wit/workitems/WORK_ITEM_ID?api-version=7.0" \
  | python -m json.tool
```

Look for these fields in the response:

```json
{
  "fields": {
    "System.Title": "Your bug title",
    "System.State": "New",
    "System.AreaPath": "TargetDMS\\TargetDMS",
    "Microsoft.VSTS.Common.Severity": "3 - Medium",
    "Microsoft.VSTS.Common.Priority": 2,
    "System.AttachedFileCount": 5
  }
}
```

---

## 11. Teams Notification

If `Teams:WebhookUrl` was set in `appsettings.Development.json`, a card is posted to the configured channel when **File Bug** is clicked.

The card message looks like:

```
New bug submitted — module **Work Orders**, severity **Medium**, team **QA**
```

> Teams notification is **best-effort** — if it fails, the ADO bug is still filed and the database still updated. Check the backend terminal output if you expected a notification but didn't receive one.

---

## 12. Troubleshooting

### "Upload failed: TypeError: Failed to fetch"

The backend is not running. Start it:

```bash
cd qa-copilot/backend
dotnet run --urls http://localhost:8080 --environment Development
```

If the backend was already started but this error appears after a system restart, Postgres may also be down. Check Docker Desktop is running, then:

```bash
cd qa-copilot
docker compose up -d postgres
```

### "Upload failed: 500 — Failed to connect to 127.0.0.1:5432"

Postgres is not running. Start it:

```bash
cd qa-copilot
docker compose up -d postgres
```

If Docker Desktop is not running, start it first from the Start menu or taskbar, wait for it to fully initialize, then run the command above.

### Popup shows "Freezing session…" but never progresses

The background service worker may have crashed. Check:
```
chrome://extensions → QA Copilot → "Service Worker" link → Console tab
```

Common causes:
- Debugger attach failed (tab navigated away before attach completed) — try again on the target tab
- Extension loaded from a dev build — run `npm run build` and reload from `dist/`

### Console Error Summary and Failed API Summary are empty

The debugger collects data from the moment it attaches to the tab (when the tab first loads the target site). If you capture immediately after opening the tab, there may not be enough data yet.

**Fix:** Let the page fully load and reproduce the issue — click around, trigger the error — then capture. The summaries will reflect whatever errors occurred after the tab opened.

If you reloaded the page right before capturing, that also resets the collector. Reproduce the issue after the reload before capturing.

### "Generating report with Claude…" hangs or fails

Verify `claude` is on your PATH:

```bash
claude --version
```

If the command is not found, ensure Claude CLI is installed and on the system PATH, then restart the backend terminal.

### ADO filing fails — status is FAILED

Check the error detail:

```bash
docker compose exec postgres psql -U postgres -d qa_copilot \
  -c "SELECT error_details FROM bug_reports WHERE status = 'FAILED' ORDER BY created_at DESC LIMIT 1;"
```

Common errors:

| Error message | Fix |
|---------------|-----|
| `401 Unauthorized` | ADO PAT is expired or missing Work Items scope — update `Ado:Pat` in `appsettings.Development.json` |
| `404 Not Found` on attachment upload | Verify `Ado:OrgUrl` and `Ado:Project` in `appsettings.Development.json` |
| `TF401349` | PAT does not have permission to create work items in TargetDMS |
| Raw HTML in error | Bad PAT — the ADO API returned an HTML error page. Regenerate the PAT. |

### Extension popup is blinking

You loaded the extension from a **dev build**. Run `npm run build` and reload:

```bash
cd qa-copilot/extension
npm run build
```

Then go to `chrome://extensions` → click the **Reload** button (↺) on QA Copilot.

### Silent Issue Notifier toast is not appearing

**Most likely cause:** the target tab was open before the extension was (re)loaded, so the content script was not injected.

**Fix:** click the QA Copilot icon → **▶ Start Recording**. The extension re-injects the content script automatically when recording starts. You do not need to reload the tab.

If that does not help, confirm:
1. Recording is active (green icon with REC badge)
2. You are on `https://test-dms.targetdealer.com/*` — the notifier is disabled on all other domains
3. A real `console.error` or uncaught exception is occurring on the page (open DevTools → Console to verify)
4. The same error was not already shown in the last 60 seconds (deduplication window)

### "Ctrl+Shift+B does nothing"

The keyboard shortcut only works while recording is active. Click the toolbar icon → **▶ Start Recording** first, then use the shortcut.

### Sensitive data appearing in the report

Check the redaction pipeline fired correctly:

```sql
SELECT draft_report->'redaction_report' FROM bug_reports ORDER BY created_at DESC LIMIT 1;
```

The `redaction_report` field lists what was removed:
```json
{
  "maskedFields": ["authToken", "sessionKey"],
  "strippedBodies": 2,
  "removedCookies": [".AspNetCore.Session"]
}
```

If a sensitive field slipped through, add its key pattern to `SENSITIVE` in `UserActionCollector.ts` or `SECRET_KEY` in `RedactionPipeline.ts` and rebuild.

---

## Quick Reference — Useful psql Commands

```sql
-- See all bug reports
SELECT id, status, severity, module, ado_work_item_id, created_at FROM bug_reports ORDER BY created_at DESC;

-- See full draft for a specific report
SELECT draft_report FROM bug_reports WHERE id = <ID>;

-- See what the human edited before filing
SELECT edited_report FROM bug_reports WHERE id = <ID>;

-- See evidence file paths
SELECT evidence_manifest FROM bug_reports WHERE id = <ID>;

-- Count by status
SELECT status, COUNT(*) FROM bug_reports GROUP BY status;

-- Find all failed filings
SELECT id, error_details, created_at FROM bug_reports WHERE status = 'FAILED';

-- Delete a test record (use capture_id from the popup or logs)
DELETE FROM bug_reports WHERE capture_id = '<uuid>';
```
