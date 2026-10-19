import { ConsoleNetworkCollector } from "../collectors/ConsoleNetworkCollector";
import { ScreenshotCollector } from "../collectors/ScreenshotCollector";
import { SessionCollector } from "../collectors/SessionCollector";
import { EnvironmentCollector } from "../collectors/EnvironmentCollector";
import { RedactionPipeline } from "../redaction/RedactionPipeline";
import { UploadClient } from "../shared/UploadClient";
import { DebuggerSession } from "./DebuggerSession";

const BACKEND = "http://localhost:8080";

export type CaptureStatus =
  | { phase: "idle" }
  | { phase: "capturing" }
  | { phase: "uploading" }
  | { phase: "generating"; report_id: number }
  | { phase: "drafted"; report_id: number }
  | { phase: "error"; message: string };

export class CaptureController {
  private screenshotCollector = new ScreenshotCollector();
  private sessionCollector = new SessionCollector();
  private environmentCollector = new EnvironmentCollector();
  private redaction = new RedactionPipeline();
  private upload = new UploadClient(BACKEND);

  async ensureOffscreen() {
    try {
      const existing = await chrome.offscreen.hasDocument();
      if (!existing) {
        await chrome.offscreen.createDocument({
          url: "src/offscreen/offscreen.html",
          reasons: [chrome.offscreen.Reason.USER_MEDIA],
          justification: "Record the rolling video buffer for bug capture.",
        });
      }
    } catch {
      // Offscreen API unavailable in this context — safe to ignore.
    }
  }

  private capturing = false;

  async capture(tabId: number): Promise<CaptureStatus> {
    if (this.capturing) return { phase: "capturing" };
    this.capturing = true;
    DebuggerSession.capturing = true;

    try {
      return await this._capture(tabId);
    } finally {
      this.capturing = false;
      DebuggerSession.capturing = false;
    }
  }

  private async _capture(tabId: number): Promise<CaptureStatus> {
    // Broadcast capturing state to any open popups.
    this.broadcast({ phase: "capturing" });

    let tab: chrome.tabs.Tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      const err: CaptureStatus = { phase: "error", message: "Recording tab no longer exists." };
      this.broadcast(err);
      return err;
    }

    try {
      await DebuggerSession.attach(tabId);
    } catch {
      // Already attached — continue.
    }

    // Snapshot all collectors then reset so the next capture starts fresh.
    const { console: consoleLogs, network } = ConsoleNetworkCollector.snapshot();
    ConsoleNetworkCollector.reset();
    const screenshot = await this.screenshotCollector.snapshot(tabId).catch(
      () => ({ viewportPng: "", fullPagePng: "" })
    );
    const session = await this.sessionCollector.snapshot(tab);
    const environment = await this.environmentCollector.snapshot(tabId, tab.url ?? "");

    let actions: string[] = [];
    try {
      const resp = await chrome.tabs.sendMessage(tabId, { type: "SNAPSHOT_ACTIONS" });
      actions = resp?.steps ?? [];
    } catch {
      // Content script not on this tab.
    }

    const capture_id = crypto.randomUUID();
    let pkg: any = {
      capture_id,
      captured_at: new Date().toISOString(),
      session,
      environment,
      actions,
      console: consoleLogs,
      network,
      screenshot,
    };

    // Redact before leaving the browser — fail closed.
    try {
      const { pkg: redacted } = this.redaction.run(pkg);
      pkg = redacted;
    } catch (e) {
      const err: CaptureStatus = { phase: "error", message: `Redaction failed: ${e}` };
      this.broadcast(err);
      return err;
    }

    this.broadcast({ phase: "uploading" });

    let report_id: number;
    try {
      const result = await this.upload.upload(pkg);
      report_id = result.report_id;
    } catch (e) {
      const message = String(e).includes("Failed to fetch")
        ? "Backend offline. In qa-copilot/backend run: dotnet run --urls http://localhost:8080 --environment Development"
        : `Upload failed: ${e}`;
      const err: CaptureStatus = { phase: "error", message };
      this.broadcast(err);
      return err;
    }

    // Generate the draft before opening the tab so the review page loads instantly.
    this.broadcast({ phase: "generating", report_id });
    try {
      const res = await fetch(`${BACKEND}/api/reports/${report_id}/generate`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      const err: CaptureStatus = { phase: "error", message: `Generate failed: ${e}` };
      this.broadcast(err);
      return err;
    }

    // Draft is ready — open the review tab now.
    await chrome.tabs.create({
      url: chrome.runtime.getURL("src/review/index.html") + `?reportId=${report_id}`,
    });

    // Reset so the popup shows "Capture Bug" again for the next issue.
    chrome.storage.session.remove("captureStatus");
    chrome.runtime.sendMessage({ type: "CAPTURE_STATUS", status: { phase: "idle" } }).catch(() => {});
    return { phase: "idle" };
  }

  private broadcast(status: CaptureStatus) {
    // Persist so popup can read the latest state on mount (avoids race with Ctrl+Shift+B).
    chrome.storage.session.set({ captureStatus: status });
    chrome.runtime.sendMessage({ type: "CAPTURE_STATUS", status }).catch(() => {
      // No popup open yet — stored state covers this.
    });
  }
}
