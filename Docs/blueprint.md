# QA Copilot — Technical Implementation Guide

## Purpose

This document provides a complete technical implementation guide for **QA Copilot** — a two-part system plus an autonomous build harness:

- **`qa-copilot-extension`** — a TypeScript Manifest V3 browser extension that runs evidence collectors from when QA clicks **Start Recording**, freezes the session on capture, redacts secrets/PII client-side, and uploads an evidence package to the backend.
- **`qa-copilot-backend`** — a single .NET 8 (ASP.NET Core) service that receives the evidence package, invokes **Claude CLI** as a local subprocess behind an `ILlmProvider` interface to draft a structured bug report, and — on explicit human confirmation — files a developer-ready **Azure DevOps** bug into the **TargetDMS** project with the captured evidence attached and posts an optional **Microsoft Teams** notification.
- **`ralph/`** — the ralph loop runner that drives Claude Code against `prd.md` to build the system iteratively.

The extension talks to exactly three external surfaces, all reached from the background service worker or the backend:

- **Backend API** — receives the evidence package (`POST /api/evidence`) and drives generation and filing.
- **Claude CLI (host subprocess)** — invoked by the backend behind `ILlmProvider` for report generation.
- **PostgreSQL + local volume** — report metadata/index and evidence blobs; **Azure DevOps** and **Teams** are the two outbound integrations.

The whole system comes up locally via a single `docker-compose` command (backend + PostgreSQL), with Claude CLI running on the host. This document is intended to be consumed by a developer or copilot agent to plan and implement the system.

---

## Technology Stack

| Component | Technology |
| --- | --- |
| Extension | TypeScript, Manifest V3 (background service worker + content scripts + offscreen document) |
| Extension UI | React 18 + MUI (popup / review-before-file screen) |
| Console & Network capture | `chrome.debugger` (Chrome DevTools Protocol 1.3) |
| Media capture | `chrome.tabCapture` + `MediaRecorder` (rolling buffer); `chrome.tabs.captureVisibleTab` + CDP `Page.captureScreenshot` (screenshots) |
| Extension build | Vite + `@crxjs/vite-plugin` |
| Backend | .NET 8, ASP.NET Core Web API (controllers) |
| Data access | EF Core 8 + Npgsql (JSONB columns) |
| LLM provider | Claude CLI, invoked as a local subprocess behind `ILlmProvider` |
| Database | PostgreSQL 16 (Docker), `pgvector` extension on the same instance (future dedup) |
| Evidence storage | Local `docker-compose` volume, referenced from Postgres metadata |
| Integrations | Azure DevOps REST API (Work Items + attachments); Microsoft Teams via Power Automate incoming webhook (demo substitute for Microsoft Graph — posts to one fixed channel) |
| Orchestration | PostgreSQL in Docker (`docker compose up -d postgres`); backend runs on host via `dotnet run`; Claude CLI on host |
| Build harness | `ralph/run-loop.sh` driving Claude Code in headless/print mode against `prd.md` |

---

## Project Structure

Monorepo layout under `qa-copilot/`:

```
qa-copilot/
├── docker-compose.yml
├── db/
│   └── init.sql                         # schema + pgvector extension
├── extension/                            # TypeScript MV3
│   ├── manifest.json
│   ├── vite.config.ts
│   └── src/
│       ├── background/
│       │   ├── index.ts                  # service-worker entry (orchestrator)
│       │   ├── CaptureController.ts       # freeze → snapshot → redact → upload
│       │   └── DebuggerSession.ts         # chrome.debugger / CDP attach + events
│       ├── offscreen/
│       │   ├── offscreen.html
│       │   └── VideoBuffer.ts            # MediaRecorder rolling buffer
│       ├── content/
│       │   ├── UserActionCollector.ts    # DOM events + field masking
│       │   └── SilentIssueNotifier.ts    # silent error toast (Shadow DOM)
│       ├── collectors/
│       │   ├── SessionCollector.ts
│       │   ├── EnvironmentCollector.ts
│       │   ├── ConsoleNetworkCollector.ts
│       │   └── ScreenshotCollector.ts
│       ├── redaction/
│       │   └── RedactionPipeline.ts      # non-negotiable, client-side
│       ├── shared/
│       │   ├── EvidencePackage.ts        # types
│       │   └── UploadClient.ts           # multipart upload to backend
│       ├── popup/                         # React + MUI popup (start/stop recording, capture)
│       │   ├── main.tsx
│       │   └── ReviewScreen.tsx
│       └── review/
│           └── review.tsx                 # full-tab review-before-file UI (?reportId=…)
├── backend/                              # .NET 8 ASP.NET Core
│   ├── Program.cs                        # host entry
│   ├── QaCopilot.Backend.csproj
│   ├── Dockerfile
│   ├── appsettings.json
│   ├── Controllers/
│   │   ├── EvidenceController.cs
│   │   └── ReportsController.cs
│   ├── Data/
│   │   ├── AppDbContext.cs
│   │   └── BugReport.cs                   # entity (bug_reports)
│   ├── Evidence/
│   │   ├── IEvidenceStore.cs
│   │   └── VolumeEvidenceStore.cs
│   ├── Llm/
│   │   ├── ILlmProvider.cs
│   │   ├── ClaudeCliLlmProvider.cs
│   │   ├── PromptTemplate.cs             # versioned prompt
│   │   └── BugReportDraft.cs             # structured output DTO
│   ├── Ado/
│   │   ├── IAdoClient.cs
│   │   └── AdoRestClient.cs
│   └── Teams/
│       ├── INotifier.cs
│       └── TeamsWebhookNotifier.cs
└── ralph/
    ├── run-loop.sh                       # the loop
    ├── iteration-prompt.md               # fixed per-iteration prompt
    ├── verify.sh                         # per-task verification gate
    └── progress.md                       # single source of truth for state
```

### Entry points

**`extension/manifest.json`** — declares MV3 permissions and the three execution contexts.

```json
{
  "manifest_version": 3,
  "name": "QA Copilot",
  "version": "0.1.0",
  "background": { "service_worker": "src/background/index.ts", "type": "module" },
  "content_scripts": [
    { "matches": ["https://test-dms.targetdealer.com/*"], "js": ["src/content/UserActionCollector.ts"], "run_at": "document_start" },
    { "matches": ["https://test-dms.targetdealer.com/*"], "js": ["src/content/SilentIssueNotifier.ts"], "run_at": "document_idle" }
  ],
  "permissions": ["debugger", "tabCapture", "offscreen", "scripting", "storage", "activeTab", "tabs", "webNavigation", "cookies"],
  "host_permissions": ["https://test-dms.targetdealer.com/*", "http://localhost:8080/*"],
  "commands": {
    "capture-bug": {
      "suggested_key": { "default": "Ctrl+Shift+B" },
      "description": "Capture Bug — freeze the session and assemble evidence"
    }
  },
  "action": { "default_popup": "src/popup/index.html" }
}
```

> The `service_worker` and `content_scripts` `.ts` paths above are rewritten to the compiled bundle by `@crxjs/vite-plugin` at build; raw TypeScript is not shipped.

**`backend/Program.cs`** — host entry (analogous to the template's application bootstrap class).

```csharp
using Microsoft.EntityFrameworkCore;
using QaCopilot.Backend.Data;
using QaCopilot.Backend.Evidence;
using QaCopilot.Backend.Llm;
using QaCopilot.Backend.Ado;
using QaCopilot.Backend.Teams;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddDbContext<AppDbContext>(o =>
    o.UseNpgsql(builder.Configuration.GetConnectionString("Postgres")));

builder.Services.AddSingleton<IEvidenceStore, VolumeEvidenceStore>();
builder.Services.AddSingleton<ILlmProvider, ClaudeCliLlmProvider>();
builder.Services.AddHttpClient<IAdoClient, AdoRestClient>();
builder.Services.AddHttpClient<INotifier, TeamsWebhookNotifier>();

var app = builder.Build();
app.MapControllers();
app.Run();
```

---

## Extension Core (background/ + offscreen/)

The background service worker is the orchestrator. Because MV3 evicts service workers aggressively, **all durable recording lives in the offscreen document**, and the worker holds no long-lived state — it wires collectors, owns the capture trigger, and coordinates the freeze. This is the cross-cutting concern the rest of the extension depends on.

### `background/index.ts` — orchestrator & trigger

```ts
import { CaptureController } from "./CaptureController";
import { ConsoleNetworkCollector } from "../collectors/ConsoleNetworkCollector";
import { DebuggerSession } from "./DebuggerSession";
import { NavigationLog } from "../collectors/NavigationLog";

const controller = new CaptureController();
let recordingTabId: number | null = null;

NavigationLog.init();

// ── Recording lifecycle ───────────────────────────────────────────────────────
async function startRecording(tabId: number) {
  recordingTabId = tabId;
  await DebuggerSession.attach(tabId).catch(() => {/* already attached */});
  ConsoleNetworkCollector.reset();
  // Re-inject content scripts in case the tab was open before the extension loaded.
  const cs = chrome.runtime.getManifest().content_scripts ?? [];
  for (const entry of cs) {
    if (entry.js?.length)
      await chrome.scripting.executeScript({ target: { tabId }, files: entry.js }).catch(() => {});
  }
  await chrome.storage.session.set({ recordingState: "recording", recordingTabId: tabId });
  applyIcon(true);
}

function stopRecording() {
  if (recordingTabId != null) chrome.debugger.detach({ tabId: recordingTabId }).catch(() => {});
  recordingTabId = null;
  ConsoleNetworkCollector.reset();
  chrome.storage.session.remove(["recordingState", "recordingTabId"]);
  applyIcon(false);
}

// Restore recording state after service-worker eviction.
chrome.storage.session.get(["recordingState", "recordingTabId"]).then((r: any) => {
  if (r.recordingState === "recording" && r.recordingTabId) {
    recordingTabId = r.recordingTabId;
    applyIcon(true);
    DebuggerSession.attach(recordingTabId!).catch(() => {});
  } else {
    applyIcon(false);
  }
});

// ── Tab lifecycle ─────────────────────────────────────────────────────────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === recordingTabId && changeInfo.status === "loading")
    DebuggerSession.attach(tabId).catch(() => {});
});
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === recordingTabId) stopRecording();
});

// Keep recording state alive when the user dismisses the Chrome debugger infobar.
// Any other detach reason triggers a reattach so CDP capture stays continuous.
chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId && source.tabId === recordingTabId && reason !== "canceled_by_user")
    DebuggerSession.reattach(source.tabId);
});

// ── Commands + messages ───────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => { void controller.ensureOffscreen(); applyIcon(false); });

chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === "capture-bug" && recordingTabId != null) void controller.capture();
});
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "CAPTURE_BUG") {
    if (recordingTabId == null) { sendResponse({ phase: "error", message: "Not recording." }); return; }
    controller.capture().then((r) => sendResponse(r)); return true;
  }
  if (msg.type === "START_RECORDING") {
    chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      if (!tab?.id) { sendResponse({ ok: false }); return; }
      await startRecording(tab.id);
      sendResponse({ ok: true });
    }); return true;
  }
  if (msg.type === "STOP_RECORDING") { stopRecording(); sendResponse({ ok: true }); }
});
```

### `offscreen/VideoBuffer.ts` — rolling buffer via MediaRecorder

The buffer keeps only the trailing window (default 180s) by trimming timesliced chunks. Recording runs here, not in the worker, so eviction never interrupts it.

```ts
export class VideoBuffer {
  private recorder?: MediaRecorder;
  private chunks: { t: number; blob: Blob }[] = [];
  private windowMs = 180_000; // 3-min fixed rolling window

  async start(streamId: string) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } } as any,
    });
    this.recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9" });
    this.recorder.ondataavailable = (e) => {
      const now = Date.now();
      this.chunks.push({ t: now, blob: e.data });
      // Trim anything older than the rolling window — bounded storage.
      const cutoff = now - this.windowMs;
      this.chunks = this.chunks.filter((c) => c.t >= cutoff);
    };
    this.recorder.start(1_000); // 1s timeslice
  }

  /** On capture: return only the preceding window as one Blob. */
  snapshot(): Blob {
    return new Blob(this.chunks.map((c) => c.blob), { type: "video/webm" });
  }
}
```

> **Transfer note:** `chrome.runtime.sendMessage` cannot structured-clone a `Blob` across contexts, so on capture the offscreen document either converts the snapshot to a base64 string / `ArrayBuffer` for the worker to reassemble, or uploads the `video` part to the backend directly. The worker never holds the raw `Blob` from the offscreen context.

The worker creates the offscreen document and hands it a tab-capture stream id:

```ts
// CaptureController.ensureOffscreen()
await chrome.offscreen.createDocument({
  url: "src/offscreen/offscreen.html",
  reasons: [chrome.offscreen.Reason.USER_MEDIA],
  justification: "Record the rolling video buffer for bug capture.",
});
const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
chrome.runtime.sendMessage({ type: "START_BUFFER", streamId });
```

### `background/DebuggerSession.ts` — CDP console + network

One `chrome.debugger` attachment feeds both the console and network collectors. HAR-ready network data and rich console events come from the same subscription — no `fetch`/`XHR`/`console` monkeypatching.

```ts
// Time-based dedup: suppress the same error text within a 60-second window.
const DEDUP_WINDOW_MS = 60_000;
const recentErrors = new Map<string, number>(); // first-120-chars of message → timestamp

export class DebuggerSession {
  // Set true during an active capture so toasts are suppressed while capturing.
  static capturing = false;

  static async attach(tabId: number) {
    try {
      await chrome.debugger.attach({ tabId }, "1.3");
      await chrome.debugger.sendCommand({ tabId }, "Network.enable", {});
      await chrome.debugger.sendCommand({ tabId }, "Runtime.enable", {});
      await chrome.debugger.sendCommand({ tabId }, "Log.enable", {});
      await chrome.debugger.sendCommand({ tabId }, "Page.enable", {}); // required for Page.captureScreenshot
    } finally {
      // Re-register even if attach threw "already attached" — the service worker
      // may have been evicted and restarted while the debugger session was live.
      // Chrome deduplicates identical listener references so this is safe to call
      // multiple times.
      chrome.debugger.onEvent.addListener(DebuggerSession.onEvent);
    }
  }

  static reattach(tabId: number) { void DebuggerSession.attach(tabId); }

  private static maybeNotify(tabId: number, method: string, p: any) {
    if (DebuggerSession.capturing) return;
    let message: string | undefined, src: string | undefined, line: number | undefined;
    if (method === "Runtime.exceptionThrown") {
      message = p.exceptionDetails?.text ?? p.exceptionDetails?.exception?.description;
      src = p.exceptionDetails?.url; line = p.exceptionDetails?.lineNumber;
    } else if (method === "Runtime.consoleAPICalled" && p.type === "error") {
      message = p.args?.map((a: any) => a.value ?? a.description ?? "").join(" ");
    } else if (method === "Log.entryAdded" && p.entry?.level === "error") {
      message = p.entry?.text; src = p.entry?.url; line = p.entry?.lineNumber;
    }
    if (!message?.trim() || src?.startsWith("chrome-extension://")) return;
    // Dedup: skip if same message text seen within the last 60 seconds.
    const key = message.slice(0, 120);
    const now = Date.now();
    for (const [k, t] of recentErrors) if (now - t >= DEDUP_WINDOW_MS) recentErrors.delete(k);
    if ((recentErrors.get(key) ?? 0) > now - DEDUP_WINDOW_MS) return;
    recentErrors.set(key, now);
    chrome.tabs.sendMessage(tabId, { type: "SILENT_ERROR_DETECTED", payload: { message, source: src, line } }).catch(() => {});
  }

  private static onEvent(source: chrome.debugger.Debuggee, method: string, params: unknown) {
    const p = params as any;
    switch (method) {
      case "Network.requestWillBeSent":
      case "Network.responseReceived":
      case "Network.loadingFinished":
        ConsoleNetworkCollector.onNetwork(method, params); break;
      case "Runtime.exceptionThrown":
      case "Runtime.consoleAPICalled":
      case "Log.entryAdded":
        ConsoleNetworkCollector.onConsole(method, params);
        if (source.tabId) DebuggerSession.maybeNotify(source.tabId, method, p);
        break;
    }
  }
}
```

---

## Collector Layer (collectors/ + content/)

Each collector is a small class exposing `snapshot()`, returning the slice of the evidence package it owns. The `CaptureController` calls all of them at freeze time. This layer is analogous to the template's entity layer — one type per data concern.

### `SessionCollector.ts`

```ts
export class SessionCollector {
  snapshot(tab: chrome.tabs.Tab) {
    return {
      url: tab.url,
      navigationHistory: NavigationLog.entries(),      // maintained from webNavigation
      browser: navigator.userAgent,
      os: navigator.platform,
      resolution: `${screen.width}x${screen.height}`,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      timeOnPageMs: Date.now() - NavigationLog.landedAt(),
      loggedInUser: DomProbe.detectUser(),              // best-effort, may be null
      currentModule: DomProbe.detectModule(),
    };
  }
}
```

### `EnvironmentCollector.ts`

Captures language, timezone, storage, filtered cookies, feature flags, and roles where available. Storage/cookies are handed straight into the redaction pipeline.

```ts
export class EnvironmentCollector {
  snapshot() {
    return {
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      localStorage: { ...localStorage },        // redacted downstream
      sessionStorage: { ...sessionStorage },     // redacted downstream
      cookies: CookieProbe.filtered(),           // secure/session cookies excluded
      featureFlags: DomProbe.featureFlags(),
      roles: DomProbe.userRoles(),
    };
  }
}
```

### `ConsoleNetworkCollector.ts`

Accumulates CDP events into console entries and a HAR document; flags failed requests.

```ts
export class ConsoleNetworkCollector {
  private static console: ConsoleEntry[] = [];
  private static har = new HarBuilder();
  private static readonly HIGHLIGHT = [400, 401, 403, 404, 409, 422, 500];

  static onConsole(method: string, p: any) {
    this.console.push({
      level: p.type ?? p.entry?.level ?? "error",
      text: p.exceptionDetails?.text ?? p.args?.map((a: any) => a.value).join(" ") ?? p.entry?.text,
      timestamp: Date.now(),
      stack: p.exceptionDetails?.stackTrace,
      source: p.entry?.url,
      line: p.entry?.lineNumber,
    });
  }

  static onNetwork(method: string, p: any) { this.har.consume(method, p); }

  snapshot() {
    const har = this.har.build();
    har.log.entries.forEach((e: any) => {
      e._failed = e.response && ConsoleNetworkCollector.HIGHLIGHT.includes(e.response.status);
    });
    return { console: ConsoleNetworkCollector.console, network: har };
  }
}
```

### `ScreenshotCollector.ts`

Viewport via `captureVisibleTab`; full page via CDP `Page.captureScreenshot` with `captureBeyondViewport` (avoids scroll-and-stitch).

```ts
export class ScreenshotCollector {
  async snapshot(tabId: number) {
    const viewport = await chrome.tabs.captureVisibleTab({ format: "png" });
    const full = await chrome.debugger.sendCommand({ tabId }, "Page.captureScreenshot", {
      captureBeyondViewport: true, fromSurface: true, format: "png",
    }) as { data: string };
    return { viewportPng: viewport, fullPagePng: `data:image/png;base64,${full.data}` };
  }
}
```

### `content/UserActionCollector.ts`

Runs in the page. Emits ordered, numbered, human-readable events; masks sensitive fields **at the point of capture**.

```ts
const SENSITIVE = /pass|token|secret|ssn|card|cvv|pin/i;
const steps: string[] = [];

function label(el: HTMLElement): string {
  return el.getAttribute("aria-label") ?? el.getAttribute("name") ?? el.textContent?.trim().slice(0, 40) ?? el.tagName;
}

document.addEventListener("click", (e) => {
  const el = e.target as HTMLElement;
  steps.push(`${steps.length + 1}. Click "${label(el)}"`);
}, true);

document.addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement;
  const value = SENSITIVE.test(el.name + el.type) ? "••••• (masked)" : el.value?.slice(0, 40);
  steps.push(`${steps.length + 1}. Set "${label(el)}" = ${value}`);
}, true);

chrome.runtime.onMessage.addListener((msg, _s, send) => {
  if (msg.type === "SNAPSHOT_ACTIONS") send({ steps });
});
```

---

## Redaction Pipeline (redaction/) — non-negotiable

Runs in the background worker after snapshotting and **before** the package leaves the browser or reaches Claude CLI. It masks fields, filters cookies, strips configured payload bodies, and emits a `redaction_report` (what was removed, never the values). If it throws, capture aborts (fail closed).

```ts
export interface RedactionReport { maskedFields: string[]; strippedBodies: number; removedCookies: string[]; }

export class RedactionPipeline {
  private static SECRET_KEY = /pass|token|secret|key|auth|ssn|card|cvv/i;
  private static PII = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b|\b\d{3}-\d{2}-\d{4}\b/g;

  run(pkg: EvidencePackage): { pkg: EvidencePackage; report: RedactionReport } {
    const report: RedactionReport = { maskedFields: [], strippedBodies: 0, removedCookies: [] };

    // Storage: drop secret-looking keys.
    for (const store of [pkg.environment.localStorage, pkg.environment.sessionStorage]) {
      for (const k of Object.keys(store)) {
        if (RedactionPipeline.SECRET_KEY.test(k)) { delete store[k]; report.maskedFields.push(k); }
      }
    }
    // Cookies already filtered upstream; record what was dropped.
    report.removedCookies = pkg.environment.cookies.filter(c => c.httpOnly || c.secure).map(c => c.name);

    // Network: strip request/response bodies per policy; scrub PII from URLs/headers.
    for (const entry of pkg.network.log.entries) {
      if (this.shouldStripBody(entry)) { delete entry.request.postData; delete entry.response.content.text; report.strippedBodies++; }
      entry.request.url = entry.request.url.replace(RedactionPipeline.PII, "[redacted]");
    }
    pkg.redaction_report = report;
    return { pkg, report };
  }

  private shouldStripBody(entry: any): boolean {
    // Default policy: strip bodies on auth/token endpoints; keep 4xx/5xx diagnostic bodies.
    return /auth|login|token/i.test(entry.request.url);
  }
}
```

---

## Capture & Upload (shared/)

### `shared/EvidencePackage.ts` — the contract

```ts
export interface EvidencePackage {
  capture_id: string;          // UUID, client idempotency key
  captured_at: string;         // ISO-8601
  session: SessionInfo;
  environment: EnvironmentInfo;
  actions: string[];           // numbered repro steps
  console: ConsoleEntry[];
  network: HarDocument;
  screenshot: { viewportPng: string; fullPagePng: string };
  video: Blob;                 // trimmed buffer window
  redaction_report?: RedactionReport;
}
```

### `shared/UploadClient.ts` — multipart intake

Inline JSON (session/environment/actions/console/redaction_report) travels in one part; `screenshot`, `video`, and the HAR go as blobs.

```ts
export class UploadClient {
  constructor(private baseUrl: string) {}

  async upload(pkg: EvidencePackage): Promise<{ report_id: number; status: string }> {
    const form = new FormData();
    const { screenshot, video, network, ...inline } = pkg;
    form.append("package", new Blob([JSON.stringify({ ...inline, screenshot: "ref", video: "ref" })], { type: "application/json" }));
    form.append("har", new Blob([JSON.stringify(network)], { type: "application/json" }), "network.har");
    form.append("screenshot", await (await fetch(screenshot.fullPagePng)).blob(), "screenshot.png");
    form.append("video", video, "video.webm");
    const res = await fetch(`${this.baseUrl}/api/evidence`, { method: "POST", body: form });
    return res.json();
  }
}
```

---

## Extension — Review UI (review/)

The human-in-the-loop screen (spec §4.5, §7.1.2, deliverable #3). It opens as a full tab (`src/review/review.tsx`, `?reportId=…`), triggers generation, renders every draft field as an editable MUI control, and on confirm posts the edited draft to `POST /api/reports/{id}/file`. Nothing is filed until the user clicks **File Bug**.

### `review/review.tsx`

```tsx
const API_BASE = "http://localhost:8080";
const REPORT_ID = parseInt(new URLSearchParams(location.search).get("reportId") ?? "0", 10);
const STORAGE_KEY = `qa_draft_${REPORT_ID}`;

type Draft = {
  title: string;
  bugType: string;                 // API | UI | Both
  reproSteps: string[];
  expected: string;
  observations: string[];
  suspectedModule: string;
  severity: string;
  priority: string;
  assignedTeam: string;
  // Factual metadata — read-only in the form, rendered as chips above the fields.
  targetUrl?: string;
  environment?: string;
  dealerId?: string;
};

function ReviewPage() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [filing, setFiling] = useState(false);
  const [filed, setFiled] = useState<{ id: number; url: string } | null>(null);

  // Kick off generation, then overlay any locally-saved edits on top of the server draft.
  useEffect(() => {
    fetch(`${API_BASE}/api/reports/${REPORT_ID}/generate`, { method: "POST" })
      .then((r) => r.json())
      .then(async (serverDraft: Draft) => {
        const saved = await chrome.storage.local.get(STORAGE_KEY);
        setDraft(saved[STORAGE_KEY] ?? serverDraft);
      });
  }, []);

  // Every edit auto-saves, so a closed tab never loses review work.
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [key]: value };
      chrome.storage.local.set({ [STORAGE_KEY]: next });
      return next;
    });

  async function fileBug() {
    setFiling(true);
    const res = await fetch(`${API_BASE}/api/reports/${REPORT_ID}/file`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft),
    });
    const body = await res.json();
    if (res.ok) { await chrome.storage.local.remove(STORAGE_KEY); setFiled({ id: body.ado_work_item_id, url: body.url }); }
    setFiling(false);
  }

  if (!draft) return <Typography>Loading bug report…</Typography>;
  if (filed) return <Alert severity="success">Filed ADO bug #{filed.id} — <a href={filed.url}>open in Azure DevOps</a></Alert>;

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      {/* Read-only metadata bar: ENV chip (colour-coded), Dealer chip, captured URL. */}
      <Stack direction="row" gap={1.5}>
        {draft.environment && <Chip label={`ENV: ${draft.environment}`} size="small" />}
        {draft.dealerId && <Chip label={`Dealer: ${draft.dealerId}`} size="small" variant="outlined" />}
        {draft.targetUrl && <Typography variant="caption">{draft.targetUrl}</Typography>}
      </Stack>

      <Stack spacing={2.5}>
        <TextField label="Title" value={draft.title} fullWidth
                   onChange={(e) => update("title", e.target.value)} />
        <TextField label="Repro Steps (one per line)" value={draft.reproSteps.join("\n")}
                   onChange={(e) => update("reproSteps", e.target.value.split("\n"))}
                   multiline minRows={5} fullWidth
                   helperText="Each line becomes a numbered step in ADO" />
        <TextField label="Expected" value={draft.expected} multiline minRows={2} fullWidth
                   onChange={(e) => update("expected", e.target.value)}
                   helperText='Definitive resolved state — "I know this bug is resolved when: …"' />
        <TextField label="Observations (one per line)" value={draft.observations.join("\n")}
                   onChange={(e) => update("observations", e.target.value.split("\n"))}
                   multiline minRows={4} fullWidth
                   helperText="Each line is one distinct fact — API status, console error, UI symptom" />

        <Stack direction="row" spacing={2}>
          <TextField label="Suspected Module" value={draft.suspectedModule} sx={{ flex: 1 }}
                     onChange={(e) => update("suspectedModule", e.target.value)} />
          <TextField select label="Bug Type" value={draft.bugType ?? "UI"} sx={{ flex: 1 }}
                     onChange={(e) => update("bugType", e.target.value)}>
            {["API", "UI", "Both"].map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
          </TextField>
        </Stack>

        <Stack direction="row" spacing={2}>
          <TextField select label="Severity" value={draft.severity} sx={{ flex: 1 }}
                     onChange={(e) => update("severity", e.target.value)}>
            {["Low", "Medium", "High", "Critical"].map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
          </TextField>
          <TextField select label="Priority" value={draft.priority} sx={{ flex: 1 }}
                     onChange={(e) => update("priority", e.target.value)}>
            {["Low", "Medium", "High"].map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
          </TextField>
          <TextField label="Assigned Team" value={draft.assignedTeam ?? ""} sx={{ flex: 1 }}
                     onChange={(e) => update("assignedTeam", e.target.value)} />
        </Stack>

        <Button variant="contained" size="large" disabled={filing} onClick={fileBug}>
          {filing ? "Filing to Azure DevOps…" : "File Bug"}
        </Button>
      </Stack>
    </Container>
  );
}
```

Every AI-suggested field is editable before filing. There is no free-text "Actual" box and no console / failed-API / environment summary boxes — the reviewer edits the `observations` list instead, one distinct technical signal per line, and the raw evidence tables (System Details, Network) are assembled server-side from the captured evidence rather than from LLM prose.

---

## Backend — Data Layer (Data/)

### `BugReport.cs` — entity (`bug_reports`)

Maps to the `bug_reports` table. `draft_report` / `edited_report` / `evidence_manifest` are JSONB. The top-level `Module`/`Severity`/`Priority` columns are denormalized copies of the confirmed report for SQL querying; the JSON is the source of truth.

```csharp
using System.ComponentModel.DataAnnotations.Schema;

namespace QaCopilot.Backend.Data;

[Table("bug_reports")]
public class BugReport
{
    [Column("id")] public long Id { get; set; }
    [Column("capture_id")] public Guid CaptureId { get; set; }         // UNIQUE
    [Column("created_at")] public DateTimeOffset CreatedAt { get; set; }
    [Column("updated_at")] public DateTimeOffset UpdatedAt { get; set; }
    [Column("status")] public string Status { get; set; } = "RECEIVED"; // RECEIVED/DRAFTED/EDITED/FILED/FAILED
    [Column("target_url")] public string? TargetUrl { get; set; }
    [Column("module")] public string? Module { get; set; }
    [Column("severity")] public string? Severity { get; set; }
    [Column("priority")] public string? Priority { get; set; }
    [Column("draft_report", TypeName = "jsonb")] public string? DraftReport { get; set; }
    [Column("edited_report", TypeName = "jsonb")] public string? EditedReport { get; set; }
    [Column("ado_work_item_id")] public long? AdoWorkItemId { get; set; }
    [Column("evidence_manifest", TypeName = "jsonb")] public string? EvidenceManifest { get; set; }
    [Column("error_details")] public string? ErrorDetails { get; set; }
}
```

### `AppDbContext.cs`

```csharp
using Microsoft.EntityFrameworkCore;

namespace QaCopilot.Backend.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) {}
    public DbSet<BugReport> BugReports => Set<BugReport>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<BugReport>().HasIndex(r => r.CaptureId).IsUnique(); // idempotent intake
    }
}
```

### `IEvidenceStore` / `VolumeEvidenceStore`

Writes blobs under a per-capture directory on the docker-compose volume; returns the manifest referenced from Postgres and the ADO ticket.

```csharp
public interface IEvidenceStore
{
    Task<EvidenceManifest> SaveAsync(Guid captureId, IFormFileCollection files);
    Task WriteJsonAsync(Guid captureId, string fileName, object payload, EvidenceManifest manifest);
    Task<Stream> OpenAsync(string path);
}

public class VolumeEvidenceStore : IEvidenceStore
{
    private readonly string _root; // e.g. /evidence (mounted volume)
    public VolumeEvidenceStore(IConfiguration cfg) => _root = cfg["Evidence:Root"] ?? "/evidence";

    public async Task<EvidenceManifest> SaveAsync(Guid captureId, IFormFileCollection files)
    {
        var dir = Path.Combine(_root, captureId.ToString());
        Directory.CreateDirectory(dir);
        var manifest = new EvidenceManifest();
        foreach (var f in files)
        {
            var path = Path.Combine(dir, f.FileName);
            await using var fs = File.Create(path);
            await f.CopyToAsync(fs);
            manifest.Add(f.Name, path);
        }
        return manifest;
    }
    public async Task WriteJsonAsync(Guid captureId, string fileName, object payload, EvidenceManifest manifest)
    {
        var dir = Path.Combine(_root, captureId.ToString());
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, fileName);
        await File.WriteAllTextAsync(path, JsonSerializer.Serialize(payload));
        manifest.Add(Path.GetFileNameWithoutExtension(fileName), path);
    }

    public Task<Stream> OpenAsync(string path) => Task.FromResult<Stream>(File.OpenRead(path));
}
```

---

## Backend — API Layer (Controllers/)

Three endpoints implement the pipeline. `File` is the human-in-the-loop confirm gate — nothing is filed or notified without it.

### `EvidenceController.cs` — intake (idempotent)

```csharp
[ApiController]
[Route("api/evidence")]
public class EvidenceController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IEvidenceStore _store;
    public EvidenceController(AppDbContext db, IEvidenceStore store) { _db = db; _store = store; }

    [HttpPost]
    public async Task<IActionResult> Intake([FromForm] IFormFile package)
    {
        var pkg = await JsonSerializer.DeserializeAsync<EvidencePackage>(package.OpenReadStream());
        var existing = await _db.BugReports.FirstOrDefaultAsync(r => r.CaptureId == pkg!.CaptureId);
        if (existing is not null)
            return Ok(new { report_id = existing.Id, capture_id = existing.CaptureId, status = "DUPLICATE" });

        // Blob parts (har / screenshot / video) are keyed by multipart field name.
        var manifest = await _store.SaveAsync(pkg!.CaptureId, Request.Form.Files);
        // session / console / environment / actions travel inline in the JSON package; serialize each
        // to the volume so the generate step can read it back. Manifest key = filename minus extension.
        // Note: everything lands on the volume, but almost nothing is attached to the ADO bug —
        // AdoRestClient uploads only `environment` (the sole AttachedFile relation) and
        // `screenshot`, which it embeds inline rather than attaching.
        await _store.WriteJsonAsync(pkg.CaptureId, "session.json", pkg.Session, manifest);
        await _store.WriteJsonAsync(pkg.CaptureId, "console.json", pkg.Console, manifest);
        await _store.WriteJsonAsync(pkg.CaptureId, "environment.json", pkg.Environment, manifest);
        await _store.WriteJsonAsync(pkg.CaptureId, "actions.json", pkg.Actions, manifest);
        var report = new BugReport
        {
            CaptureId = pkg.CaptureId, Status = "RECEIVED",
            TargetUrl = pkg.Session.Url, CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
            EvidenceManifest = JsonSerializer.Serialize(manifest),
        };
        _db.BugReports.Add(report);
        await _db.SaveChangesAsync();
        return Ok(new { report_id = report.Id, capture_id = report.CaptureId, status = "RECEIVED" });
    }
}
```

> `DUPLICATE` is a response-only outcome flag — it is never written to `status`; a repeated `capture_id` leaves the existing row at its current state.

### `ReportsController.cs` — generate & file

```csharp
[ApiController]
[Route("api/reports")]
public class ReportsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IEvidenceStore _store;
    private readonly ILlmProvider _llm;
    private readonly IAdoClient _ado;
    private readonly INotifier _notifier;

    public ReportsController(AppDbContext db, IEvidenceStore store, ILlmProvider llm, IAdoClient ado, INotifier notifier)
        { _db = db; _store = store; _llm = llm; _ado = ado; _notifier = notifier; }

    [HttpPost("{id}/generate")]
    public async Task<IActionResult> Generate(long id)
    {
        var report = await _db.BugReports.FindAsync(id) ?? throw new KeyNotFoundException();
        var manifest = JsonSerializer.Deserialize<Dictionary<string, string>>(report.EvidenceManifest ?? "{}")!;
        // Load session/console/environment/actions/har back off the volume (each best-effort).
        var (actions, consoleLogs, sessionEl, envEl, failedRequests) = await LoadAsync(manifest);

        // ── Trim evidence to keep the prompt small ────────────────────────────────
        // Raw localStorage/sessionStorage in a Redux app pushed the prompt to ~76 KB and
        // generation to ~52 s. The LLM only needs signal-bearing fields.
        object? envSummary = envEl.ValueKind == JsonValueKind.Object
            ? new { featureFlags = Prop(envEl, "featureFlags"), roles = Prop(envEl, "roles") }
            : null;                                       // storage stripped entirely

        object? sessionSummary = new {                     // 7 fields only
            url = Str(sessionEl, "url"), environment = Str(sessionEl, "environment"),
            dealerId = Str(sessionEl, "dealerId"), browser = Str(sessionEl, "browser"),
            os = Str(sessionEl, "os"), loggedInUser = Prop(sessionEl, "loggedInUser"),
            currentModule = Prop(sessionEl, "currentModule"),
        };

        // Cap the two unbounded arrays to their last 50 entries.
        static object? Cap(object? data, int max) =>
            data is JsonElement { ValueKind: JsonValueKind.Array } el
                ? el.EnumerateArray().TakeLast(max).ToArray() : data;

        object evidence = new
        {
            targetUrl             = report.TargetUrl,
            session               = sessionSummary,
            reproActions          = Cap(actions, 50),
            consoleLogs           = Cap(consoleLogs, 50),
            failedNetworkRequests = failedRequests,   // HAR entries with status >= 400, capped at 30
            environment           = envSummary,
        };

        var draft = await _llm.GenerateAsync(evidence);   // grounded, structured

        // Inject factual metadata from the session — never let the LLM invent these.
        draft = draft with {
            TargetUrl = report.TargetUrl,
            Environment = Str(sessionEl, "environment"),
            DealerId = Str(sessionEl, "dealerId"),
        };

        report.DraftReport = JsonSerializer.Serialize(draft);
        report.Module = draft.SuspectedModule; report.Severity = draft.Severity; report.Priority = draft.Priority;
        report.Status = "DRAFTED"; report.UpdatedAt = DateTimeOffset.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(draft);
    }

    [HttpPost("{id}/file")]
    public async Task<IActionResult> File(long id, [FromBody] BugReportDraft edited)
    {
        var report = await _db.BugReports.FindAsync(id) ?? throw new KeyNotFoundException();
        // Human-in-the-loop: persist the approved edit as EDITED before any outbound call.
        report.EditedReport = JsonSerializer.Serialize(edited);
        report.Module = edited.SuspectedModule; report.Severity = edited.Severity; report.Priority = edited.Priority;
        report.Status = "EDITED"; report.UpdatedAt = DateTimeOffset.UtcNow;
        await _db.SaveChangesAsync();

        try
        {
            var manifest = JsonSerializer.Deserialize<EvidenceManifest>(report.EvidenceManifest!)!;
            var workItemId = await _ado.CreateBugWithAttachmentsAsync(edited, manifest, _store);
            report.AdoWorkItemId = workItemId; report.Status = "FILED"; report.UpdatedAt = DateTimeOffset.UtcNow;
            await _db.SaveChangesAsync();

            await _notifier.NotifyAsync(new BugNotification(                 // optional, best-effort
                edited.Title, edited.Severity, edited.Priority, edited.SuspectedModule,
                edited.BugType, edited.Environment, edited.DealerId, edited.TargetUrl,
                edited.AssignedTeam, workItemId, _ado.WorkItemUrl(workItemId),
                edited.Expected, edited.Observations));
            return Ok(new { ado_work_item_id = workItemId, url = _ado.WorkItemUrl(workItemId), status = "FILED" });
        }
        catch (Exception ex)
        {
            report.Status = "FAILED"; report.ErrorDetails = ex.Message; await _db.SaveChangesAsync();
            return StatusCode(502, new { status = "FAILED", error = ex.Message });
        }
    }
}
```

> **Trimming is a prompt-window concern only.** The full, untrimmed evidence stays on the volume,
> and the ADO bug still renders all of it — the ReproSteps Network table is built from the complete
> HAR, not from this projection, which narrows only what the LLM *sees*. Before trimming, raw `localStorage`/`sessionStorage` from the Redux-backed
> app pushed the prompt to roughly **76 KB** and a single generation to about **52 s**.
> `LoadAsync` / `Prop` / `Str` above stand in for the inline best-effort
> `JsonDocument`/`TryGetProperty` reads in the real method.

---

## Backend — LLM Provider (Llm/)

Analogous to the template's service interface → concrete implementation. Report generation is one grounded call behind `ILlmProvider`; the Claude CLI subprocess is the only implementation for the demo.

### `ILlmProvider.cs`

```csharp
public interface ILlmProvider
{
    // `evidence` is the trimmed projection built by ReportsController.Generate,
    // serialized straight into the prompt — not the raw EvidencePackage.
    Task<BugReportDraft> GenerateAsync(object evidence, CancellationToken ct = default);
}
```

### `ClaudeCliLlmProvider.cs`

Invokes `claude` as a subprocess, pipes the grounded prompt on stdin, and parses JSON from stdout. No cloud API keys; no vendor SDK.

```csharp
public class ClaudeCliLlmProvider : ILlmProvider
{
    private readonly IConfiguration _cfg;
    private readonly ILogger<ClaudeCliLlmProvider> _log;
    public ClaudeCliLlmProvider(IConfiguration cfg, ILogger<ClaudeCliLlmProvider> log) { _cfg = cfg; _log = log; }

    public async Task<BugReportDraft> GenerateAsync(object evidence, CancellationToken ct = default)
    {
        var prompt = PromptTemplate.Build(evidence); // versioned; instructs "JSON only", grounded-in-evidence

        var claudePath = _cfg["Llm:ClaudeCliPath"] ?? "claude";
        var psi = new ProcessStartInfo
        {
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false,
        };
        // On Windows the `claude` entry point is a .cmd wrapper — it must go through cmd.exe.
        if (OperatingSystem.IsWindows()) { psi.FileName = "cmd.exe"; psi.ArgumentList.Add("/c"); psi.ArgumentList.Add(claudePath); }
        else                             { psi.FileName = claudePath; }
        psi.ArgumentList.Add("-p");                 // headless / print mode
        psi.ArgumentList.Add("--output-format"); psi.ArgumentList.Add("text");
        // No --model flag: the CLI's own configured model is used.

        var sw = Stopwatch.StartNew();
        using var proc = Process.Start(psi)!;
        await proc.StandardInput.WriteAsync(prompt); proc.StandardInput.Close();
        var stdout = await proc.StandardOutput.ReadToEndAsync(ct);
        await proc.WaitForExitAsync(ct);
        sw.Stop();
        _log.LogInformation("Claude CLI generate: {ms} ms, exit={code}, prompt_chars={n}",
            sw.ElapsedMilliseconds, proc.ExitCode, prompt.Length); // latency/spend per §7.3
        if (proc.ExitCode != 0) throw new LlmException(await proc.StandardError.ReadToEndAsync(ct));

        // Tolerate any wrapper text: take the first {...} object via regex.
        var json = Regex.Match(stdout, @"\{[\s\S]*\}") is { Success: true } m
            ? m.Value : throw new LlmException("No JSON object in CLI output");
        return JsonSerializer.Deserialize<BugReportDraft>(json,
                   new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new LlmException("Empty draft");
    }
}
```

> **Claude CLI flags** (`-p`, `--output-format`) should be confirmed against the current Claude Code docs — see References. Prompt and invocation contract are versioned artifacts in `PromptTemplate.cs`.

### `BugReportDraft.cs` — structured output

```csharp
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
    // Factual metadata injected server-side after generation, never by the LLM.
    string?  TargetUrl    = null,
    string?  Environment  = null,
    string?  DealerId     = null
);
```

> There is no `actual` field: the "actual" side of the report is the `Observations` array, one
> distinct technical signal per element. The older `consoleErrorSummary` / `failedApiSummary` /
> `environmentSummary` prose fields are gone — that evidence now surfaces as `Observations`
> bullets plus the structured System Details / Network tables the ADO client renders.
>
> There is deliberately no `suggestedFix` field either. Proposing a fix is a developer's
> call on evidence the extension cannot see (the server-side code path), so the draft stops
> at observed facts rather than speculating about causes.

### `PromptTemplate.cs` — versioned, grounded prompt

The prompt is a versioned artifact (currently **`v2`**). It supplies only the trimmed, redacted evidence as context, forbids answering from parametric memory, and — new in v2 — encodes the QA team's **house style** so the draft reads like a hand-written TargetDMS bug rather than a generic LLM summary.

```csharp
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
            Respond with ONLY a single JSON object — no markdown, no explanation.

            FIELD RULES (abridged — the real template spells each one out with examples)
            ── bugType  — "API" (non-2xx / bad payload), "UI" (broken interface, no API failure),
                          "Both" (an API failure causes visible UI breakage).
            ── title    — declarative negative state, never a question and never "should".
                          ALL-CAPS the domain keywords (status names OPEN/CLOSED/SUBMITTED, DMS
                          names ASPEN/INFINITY/TARGET, environments QA/STAGING/PRODUCTION) and
                          END with the environment. Bracket a dealer id when relevant.
                          e.g. "CLOSED deals are displaying as OPEN on TARGET QA environment"
            ── reproSteps — Step 1 MUST name environment + dealer; one atomic action per step,
                          imperative third person; the broken result is NOT a step.
            ── expected — one definitive sentence; never the word "should". Becomes the ADO
                          acceptance line "I know this bug is resolved when: <expected>".
            ── observations — the actual behaviour, one distinct technical signal per element:
                          one bullet per failing request, one per unique console error, one per
                          visible UI symptom.

            RESPONSE SHAPE (return ONLY this JSON, no markdown wrapper)
            {shape}

            EVIDENCE (trimmed + redacted):
            {JsonSerializer.Serialize(evidence)}
            """;
    }
}
```

> `Build` takes a plain `object` — the trimmed evidence projection assembled by
> `ReportsController.Generate` — not the full `EvidencePackage`.

### Adding a new LLM provider

To swap in a hosted model later: implement `ILlmProvider`, register it in `Program.cs` in place of `ClaudeCliLlmProvider`. No controller or feature code changes — the interface is the only touch point.

---

## Backend — ADO Integration (Ado/)

Analogous to the template's REST client. In one confirmed action it uploads the relevant evidence files, renders the whole report body as HTML, and creates a Bug work item in **TargetDMS**.

### `IAdoClient.cs`

```csharp
public interface IAdoClient
{
    Task<long> CreateBugWithAttachmentsAsync(BugReportDraft report, EvidenceManifest manifest, IEvidenceStore store);
    string WorkItemUrl(long id);
}
```

### `AdoRestClient.cs`

```csharp
public class AdoRestClient : IAdoClient
{
    private readonly HttpClient _http;
    private readonly string _org, _project;

    // ADO returns camelCase; deserialize case-insensitively.
    private static readonly JsonSerializerOptions CiOpts = new() { PropertyNameCaseInsensitive = true };

    public AdoRestClient(HttpClient http, IConfiguration cfg)
    {
        _http = http;
        _org = cfg["Ado:OrgUrl"]!;      // https://constellationdealer.visualstudio.com
        _project = cfg["Ado:Project"]!; // TargetDMS
        var pat = cfg["Ado:Pat"]!;      // PLACEHOLDER — injected via env at runtime
        var basic = Convert.ToBase64String(Encoding.ASCII.GetBytes($":{pat}"));
        _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic", basic);
    }

    public async Task<long> CreateBugWithAttachmentsAsync(BugReportDraft r, EvidenceManifest manifest, IEvidenceStore store)
    {
        // 1) Harvest System Details facts out of the stored evidence.
        //    Browser/OS come from session.json as *friendly* names ("Chrome", "Windows"), not raw UA.
        var (browserName, osName, loggedInUser) = await ReadSessionAsync(manifest, store);
        //    DMS Dealer ID lives in environment.json → localStorage["persist:root"] → auth.dmsDealerId.
        //    persist:root is double-encoded: parse the string, then parse its `auth` string.
        var dmsDealerId = await ReadDmsDealerIdAsync(manifest, store);
        //    The HAR gives both the Network table and the Customer/Order ids found in POST bodies.
        var (networkHtml, customerId, orderId) = await ReadHarAsync(manifest, store);

        // 2) Upload attachments. Only two files are uploaded: `environment` — the sole entry in
        //    the ADO Attachments tab — and `screenshot`, uploaded only to obtain a URL to embed
        //    and deliberately NOT added as an AttachedFile relation. Everything else (actions,
        //    console, har, session, video) is already rendered into the ReproSteps document.
        var upload = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "environment", "screenshot" };
        var refs = new List<(string name, string url)>();
        string? screenshotAdoUrl = null;

        foreach (var (name, path) in manifest.Files)
        {
            if (!upload.Contains(name)) continue;
            await using var s = await store.OpenAsync(path);
            var up = await _http.PostAsync(
                $"{_org}/{_project}/_apis/wit/attachments?fileName={Uri.EscapeDataString(Path.GetFileName(path))}&api-version=7.0",
                new StreamContent(s));
            // Non-2xx and non-JSON bodies are logged and skipped — a bad attachment never blocks filing.
            if (!up.IsSuccessStatusCode) continue;
            var url = JsonSerializer.Deserialize<AdoAttachment>(await up.Content.ReadAsStringAsync(), CiOpts)?.Url;
            if (url is null) continue;
            if (name.Equals("screenshot", StringComparison.OrdinalIgnoreCase)) screenshotAdoUrl = url;
            else refs.Add((name, url));
        }

        // 3) ReproSteps is ONE HTML document with four headings, in this order.
        var reproSection =
            "<b>Repro Steps</b>" +
            $"<ul>{string.Concat(r.ReproSteps.Select(s => $"<li>{H(s)}</li>"))}</ul>" +
            "<div><b>OBSERVATION:</b></div>" +
            $"<ul>{string.Concat(r.Observations.Select(o => $"<li>{H(o)}</li>"))}</ul>";

        var sysRows = new StringBuilder();
        void Row(string k, string? v) => sysRows.Append($"<tr><td><b>{k}</b></td><td>{H(v)}</td></tr>");
        Row("DMS Dealer ID", dmsDealerId); Row("Dealer ID", r.DealerId);
        Row("Environment", r.Environment); Row("URL", r.TargetUrl);
        Row("Browser", browserName);       Row("OS", osName);
        Row("Logged-in User", loggedInUser);
        if (customerId is not null) Row("Customer ID", customerId);   // only when found in the HAR
        if (orderId    is not null) Row("Order ID",    orderId);
        var systemSection = $"<br/><b>System Details</b><table border=\"1\" cellpadding=\"4\">{sysRows}</table>";

        var networkSection = "<br/><b>Network</b><br/>" + networkHtml;   // every HAR entry, 4xx orange / 5xx red

        var attachmentsSection = "<br/><b>Attachments</b><br/>" + (screenshotAdoUrl is not null
            ? $"<img src=\"{screenshotAdoUrl}\" alt=\"Screenshot\" style=\"max-width:100%;\" />"
            : "<i>No screenshot captured.</i>");

        var reproHtml = reproSection + systemSection + networkSection + attachmentsSection;

        // 4) Create the Bug with fields + attachment relations (JSON Patch).
        var patch = new List<object>
        {
            new { op = "add", path = "/fields/System.Title",                             value = r.Title },
            new { op = "add", path = "/fields/System.AreaPath",                          value = @"TargetDMS\TargetDMS" },
            new { op = "add", path = "/fields/System.IterationPath",                     value = "TargetDMS" },
            new { op = "add", path = "/fields/Microsoft.VSTS.TCM.ReproSteps",            value = reproHtml },
            new { op = "add", path = "/fields/Microsoft.VSTS.Common.Severity",           value = MapSeverity(r.Severity) },
            new { op = "add", path = "/fields/Microsoft.VSTS.Common.Priority",           value = MapPriority(r.Priority) },
            new { op = "add", path = "/fields/Microsoft.VSTS.Common.ValueArea",          value = "Business" },
            new { op = "add", path = "/fields/Microsoft.VSTS.Common.AcceptanceCriteria",
                  value = $"I know this bug is resolved when:<ul><li>{H(r.Expected)}</li></ul>" },
            new { op = "add", path = "/fields/Microsoft.VSTS.TCM.SystemInfo",
                  value = $"<b>Bug Type:</b> {r.BugType}<br/><b>Captured URL:</b> {r.TargetUrl}<br/>" +
                          $"<b>Environment:</b> {r.Environment}<br/><b>Dealer ID:</b> {r.DealerId}<br/>" +
                          $"<b>How found:</b> QA Copilot — AI-assisted evidence capture" },
        };
        patch.AddRange(refs.Select(a => (object)new {
            op = "add", path = "/relations/-",
            value = new { rel = "AttachedFile", url = a.url, attributes = new { comment = a.name } }
        }));

        var content = new StringContent(JsonSerializer.Serialize(patch), Encoding.UTF8, "application/json-patch+json");
        var res = await _http.PostAsync($"{_org}/{_project}/_apis/wit/workitems/$Bug?api-version=7.0", content);
        var body = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException($"ADO work item creation failed {(int)res.StatusCode}: {body}");
        return JsonSerializer.Deserialize<AdoWorkItem>(body, CiOpts)!.Id;
    }

    public string WorkItemUrl(long id) => $"{_org}/{_project}/_workitems/edit/{id}";

    // Every interpolated value goes through H(): HTML-encodes, and renders missing values as an em-dash.
    private static string H(string? s) =>
        string.IsNullOrWhiteSpace(s) ? "—" : System.Net.WebUtility.HtmlEncode(s);

    // ADO Severity is the string "N - Label"; Priority is an int 1–4. Both confirmed against live TargetDMS bugs.
    private static string MapSeverity(string s) => s.ToLower() switch {
        "critical" => "1 - Critical", "high" => "2 - High", "medium" => "3 - Medium", _ => "4 - Low" };
    private static int MapPriority(string p) => p.ToLower() switch {
        "high" => 1, "medium" => 2, "low" => 3, _ => 4 };
}
```

Notes on the pieces kept out of the listing above:

- **`ReadHarAsync` / `BuildNetworkHtml`** walks `log.entries` and emits a Method / Status / URL table for
  **every** captured request (not just failures), colouring 4xx orange and 5xx red and filtering out
  `chrome-extension://` noise. While walking, it parses POST bodies for `customerId` and
  `workOrderId` / `orderId` — that's where the optional Customer ID / Order ID rows come from.
- **`ParseBrowserName` / `ParseOsName`** reduce the captured user-agent and `navigator.platform` to
  friendly names ("Chrome", "Edge", "Firefox", "Safari" / "Windows", "macOS", "Linux").
- HTML encoding uses **`System.Net.WebUtility.HtmlEncode`**, not `System.Web.HttpUtility` (the latter
  is not available in this ASP.NET Core project).
- Attachment upload responses are deserialized **case-insensitively** (`CiOpts`) — ADO returns
  camelCase `url`.

> The field schema above (area/iteration paths, `"N - Label"` severity, integer priority) was
> confirmed by inspecting real bugs in the live TargetDMS project. `System.Description` is
> deliberately unused — the whole report body lives in `Microsoft.VSTS.TCM.ReproSteps`, which is
> the field the QA team actually reads.

---

## Backend — Teams Notifier (Teams/)

Optional, behind `INotifier`, posting to a single incoming webhook (a deliberate demo substitute for Microsoft Graph). Failure is best-effort and never reverses a successful ADO filing.

### `INotifier.cs`

```csharp
public record BugNotification(
    string   Title,
    string   Severity,
    string   Priority,
    string   Module,
    string?  BugType,
    string?  Environment,
    string?  DealerId,
    string?  TargetUrl,
    string?  AssignedTeam,
    long     AdoWorkItemId,
    string   AdoWorkItemUrl,
    string?  Expected,
    string[] Observations      // no Actual — observations are the actual behaviour
);

public interface INotifier
{
    Task NotifyAsync(BugNotification n, CancellationToken ct = default);
}
```

### `TeamsWebhookNotifier.cs`

```csharp
public class TeamsWebhookNotifier : INotifier
{
    private readonly HttpClient _http;
    private readonly string? _webhook;
    public TeamsWebhookNotifier(HttpClient http, IConfiguration cfg) { _http = http; _webhook = cfg["Teams:WebhookUrl"]; }

    public async Task NotifyAsync(BugNotification n, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(_webhook)) return; // optional — no-op if unconfigured

        var emoji = n.Severity?.ToLower() switch
            { "critical" => "🔴", "high" => "🟠", "medium" => "🟡", _ => "🟢" };

        // Adaptive Card payload — works with both Power Automate flows and the
        // legacy Teams Incoming Webhook connector.
        var card = new
        {
            type = "message",
            attachments = new[] { new {
                contentType = "application/vnd.microsoft.card.adaptive",
                content = new {
                    type = "AdaptiveCard", version = "1.4",
                    body = new object[] {
                        new { type = "TextBlock", text = $"{emoji} Bug Filed: {n.Title}",
                              weight = "Bolder", size = "Medium", wrap = true },
                        new { type = "FactSet", facts = new object[] {
                            new { title = "Severity",    value = n.Severity },
                            new { title = "Priority",    value = n.Priority },
                            new { title = "Bug Type",    value = n.BugType ?? "—" },
                            new { title = "Module",      value = n.Module },
                            new { title = "Environment", value = n.Environment ?? "—" },
                            new { title = "Dealer ID",   value = n.DealerId ?? "—" },
                            new { title = "Team",        value = n.AssignedTeam ?? "Unassigned" },
                            new { title = "ADO ID",      value = $"#{n.AdoWorkItemId}" },
                        } },
                        new { type = "TextBlock", wrap = true, size = "Small",
                              text = $"**URL:** {n.TargetUrl ?? "—"}" },
                        new { type = "TextBlock", wrap = true, size = "Small",
                              text = $"**Expected:** {n.Expected}\n**Observations:** " +
                                     (n.Observations.Length > 0 ? string.Join(" | ", n.Observations) : "—") },
                    },
                    actions = new object[] { new {
                        type = "Action.OpenUrl", title = "Open in Azure DevOps", url = n.AdoWorkItemUrl } },
                },
            } },
        };

        try { await _http.PostAsJsonAsync(_webhook, card, ct); }
        catch (Exception) { /* logged, swallowed — best-effort */ }
    }
}
```

---

## Ralph Loop Runner (ralph/)

The build harness. `run-loop.sh` invokes **Claude Code in headless/print mode** each iteration against the fixed prompt, runs the verification gate, and commits per iteration. `progress.md` is the single source of truth for state.

### `ralph/run-loop.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

MAX_ITERS="${MAX_ITERS:-60}"
i=0

while (( i < MAX_ITERS )); do
  [[ -f STOP ]] && { echo "STOP sentinel present — halting."; break; }

  # Done when no unchecked tasks remain in progress.md.
  if ! grep -q '^\- \[ \]' progress.md; then
    echo "All tasks complete."; break
  fi

  echo "=== Ralph iteration $i ==="
  # Headless Claude Code against the fixed iteration prompt.
  claude -p --dangerously-skip-permissions "$(cat ralph/iteration-prompt.md)" || true

  # Per-task verification gate: build must pass before the work counts.
  if ./ralph/verify.sh; then
    git add -A && git commit -m "ralph: iteration $i" || true
  else
    echo "Verification failed — rolling back this iteration."
    git reset --hard HEAD
  fi
  (( i++ )) || true
done
```

### `ralph/iteration-prompt.md` (fixed)

```
You are building QA Copilot per prd.md. State lives in progress.md.

1. Read solution.md, blueprint.md, prd.md, and progress.md.
2. Pick the FIRST unchecked task ("- [ ]") in progress.md.
3. Implement ONLY that task, following blueprint.md exactly.
4. Run ./ralph/verify.sh. If it fails, fix until it passes.
5. Mark the task "- [x]" in progress.md with a one-line note.
6. Do not start another task. Stop.
```

### `ralph/verify.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
( cd extension && npm run build )      # extension compiles
( cd backend   && dotnet build -c Release )  # backend compiles
# task-specific checks appended here as the build grows (e.g. dotnet test)
```

### `progress.md` schema

A flat checklist mirroring `prd.md` task IDs; one line per task, `- [ ]` / `- [x]`, with an optional trailing note. Example:

```
- [x] T01 Scaffold docker-compose (backend + Postgres) — comes up clean
- [ ] T02 Extension skeleton loads unpacked in Chrome
- [ ] T03 UserActionCollector emits numbered repro steps
```

Guardrails: git commit per iteration (rollback = one `reset`), the verification gate (no advance on broken code), `MAX_ITERS` + `STOP` file (no runaway), and `progress.md` as resumable state.

> **Claude Code invocation** (`claude -p`, `--dangerously-skip-permissions`) should be confirmed against the current Claude Code docs — see References.

---

## Support Types

Small helper types referenced above, implemented alongside their owners (kept out of the main listings for brevity):

- **Extension:** `NavigationLog` (webNavigation-fed history), `DomProbe` (user/module/flags/roles detection), `CookieProbe` (secure/httpOnly filtering), `HarBuilder` (CDP events → HAR), and the `EvidencePackage` sub-types (`SessionInfo`, `EnvironmentInfo`, `ConsoleEntry`, `HarDocument`).
- **Backend:** `EvidenceManifest` (name→path map with `Add`/`Files`; keys are `session`/`console`/`environment`/`actions` for the inline JSON — filename minus extension — and `har`/`screenshot`/`video` for the multipart blobs), `BugNotification` (Teams card DTO), `AdoAttachment`/`AdoWorkItem` (`file record` REST DTOs local to `AdoRestClient`), and `LlmException`. There is no separate `EvidenceLoader` or `JsonExtractor` type: `ReportsController.Generate` reads and trims the manifest files itself, and `ClaudeCliLlmProvider` slices the first JSON object out of stdout with a private regex helper.

---

## Configuration

### `backend/appsettings.json` and `appsettings.Development.json`

`appsettings.json` holds non-secret defaults committed to source control:

```json
{
  "Evidence": { "Root": "C:\\qa-copilot-evidence" },
  "Llm": { "ClaudeCliPath": "claude" },
  "Ado": {
    "OrgUrl": "https://constellationdealer.visualstudio.com",
    "Project": "TargetDMS"
  }
}
```

All secrets and environment-specific values go in `backend/appsettings.Development.json` (gitignored — never committed):

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
    "Pat": "<ADO PAT — Work Items read/write>"
  },
  "Teams": {
    "WebhookUrl": "<Power Automate webhook URL>"
  }
}
```

> `Host=localhost` is correct because the backend runs on the host machine and reaches Postgres via the mapped port `5432`. The Docker-internal hostname `postgres` is not reachable from the host. The `${VAR}` placeholder syntax does not expand in .NET configuration — do not use it.

### `docker-compose.yml`

Only PostgreSQL runs in Docker. The backend runs on the host so it can call the `claude` CLI subprocess directly — no container networking overhead and no need to mount the host binary.

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment: { POSTGRES_DB: qa_copilot, POSTGRES_PASSWORD: postgres }
    ports: ["5432:5432"]
    volumes: ["./db/init.sql:/docker-entrypoint-initdb.d/init.sql", "pgdata:/var/lib/postgresql/data"]

volumes: { pgdata: {} }
```

**Bring-up (two steps):**

```bash
# 1. Start Postgres
docker compose up -d postgres

# 2. Start the backend on the host (keep terminal open)
cd backend
dotnet run --urls http://localhost:8080 --environment Development
```

Credentials (ADO PAT, Teams webhook URL, Postgres connection string) are stored in `backend/appsettings.Development.json` (gitignored — never committed). Then load the extension unpacked in Chrome from `extension/dist/`.

> `.claude/launch.json` defines the same two processes (`extension-dev` on 5173, `backend` on 8080) for tool-driven launches. The `backend` entry sets `"autoPort": false`: the extension hardcodes `API_BASE = "http://localhost:8080"`, so the port cannot be allowed to float.

---

## Status Lifecycle

```
RECEIVED  ──→  DRAFTED  ──→  EDITED  ──→  FILED           (happy path)
   │             │             │
   │             │             └──→  FAILED  ──→  (re-file)   ADO/Teams failed after confirm
   │             └──→  (re-generate)                          draft produced, awaiting review
   └──→  (re-generate)                                        intake only; generation not yet run / failed
```

- **RECEIVED**: written by `POST /api/evidence`. Evidence stored; generation not yet run.
- **DRAFTED**: written by `POST /api/reports/{id}/generate`. Claude CLI draft stored, awaiting human review.
- **EDITED**: written by `POST /api/reports/{id}/file` before any outbound call — the human-approved report is persisted first.
- **FILED**: terminal success. ADO Bug created with the HTML report body plus the single `environment` attachment (screenshot embedded inline); optional Teams notification sent.
- **FAILED**: ADO/Teams step failed after confirm; `error_details` recorded; retryable by re-filing.

`DUPLICATE` is a response-only outcome flag returned by intake and is **never persisted** — a repeated `capture_id` leaves the existing row at its current state.

---

## SQL / Schema Reference

All DDL and key queries, consolidated. Applied via `db/init.sql` on first Postgres start.

### S1: Schema (`db/init.sql`)

```sql
CREATE EXTENSION IF NOT EXISTS vector;   -- pgvector on the same instance (future dedup; unused this build)

CREATE TABLE bug_reports (
    id                BIGSERIAL PRIMARY KEY,
    capture_id        UUID        NOT NULL UNIQUE,          -- idempotent intake
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status            VARCHAR(20) NOT NULL DEFAULT 'RECEIVED',
    target_url        TEXT,
    module            VARCHAR(255),
    severity          VARCHAR(20),
    priority          VARCHAR(20),
    draft_report      JSONB,
    edited_report     JSONB,
    ado_work_item_id  BIGINT,
    evidence_manifest JSONB,
    error_details     TEXT
);

CREATE INDEX idx_bug_reports_status ON bug_reports (status);
```

### S2: Idempotent Intake (EvidenceController.Intake)

```sql
INSERT INTO bug_reports (capture_id, status, target_url, evidence_manifest, created_at, updated_at)
VALUES (:captureId, 'RECEIVED', :targetUrl, :manifest, NOW(), NOW())
ON CONFLICT (capture_id) DO NOTHING
RETURNING id;
-- If no row returned, the capture already exists → respond DUPLICATE with the existing id.
```

### S3: Store Draft (ReportsController.Generate)

```sql
UPDATE bug_reports
SET draft_report = :draft, module = :module, severity = :severity, priority = :priority,
    status = 'DRAFTED', updated_at = NOW()
WHERE id = :id;
```

### S4: Persist Confirmed Edit (ReportsController.File — before outbound)

```sql
UPDATE bug_reports
SET edited_report = :edited, module = :module, severity = :severity, priority = :priority,
    status = 'EDITED', updated_at = NOW()
WHERE id = :id;
```

### S5: Mark Filed / Failed (ReportsController.File — after outbound)

```sql
-- success
UPDATE bug_reports SET ado_work_item_id = :workItemId, status = 'FILED', updated_at = NOW() WHERE id = :id;
-- failure
UPDATE bug_reports SET status = 'FAILED', error_details = :error, updated_at = NOW() WHERE id = :id;
```

### S6: Status Snapshot (monitoring)

```sql
SELECT status, COUNT(*) FROM bug_reports GROUP BY status ORDER BY status;
```

---

## Reference Documents

- [Solution.md](./solution.md)
- Project Specification — QA Copilot Browser Extension (OPE AI Initiatives)
- [Claude Code docs map](https://docs.anthropic.com/en/docs/claude-code/claude_code_docs_map.md) — headless/print mode and CLI flags
- Chrome DevTools Protocol — `Network`, `Runtime`, `Log`, `Page.captureScreenshot`
- Chrome Extensions — Manifest V3 `offscreen`, `tabCapture`, `chrome.debugger`
- Azure DevOps REST API — Work Items & attachments (api-version 7.0)
- Microsoft Teams — incoming webhooks
