import { CaptureController } from "./CaptureController";
import { ConsoleNetworkCollector } from "../collectors/ConsoleNetworkCollector";
import { DebuggerSession } from "./DebuggerSession";
import { NavigationLog } from "../collectors/NavigationLog";

const controller = new CaptureController();

// Which tab the user explicitly started recording on (null = not recording).
let recordingTabId: number | null = null;

NavigationLog.init();

// ── Icon ──────────────────────────────────────────────────────────────────────

// Draws a cog/gear icon using pure pixel math (no OffscreenCanvas).
// 8 teeth: each angular slot is divided into thirds — the middle third is the
// tooth tip (outer radius), the outer two thirds are roots (inner radius).
// A small circle is punched out at the centre.
// Red (#ef4444) when idle, green (#22c55e) when recording.
function drawGearIcon(size: number, recording: boolean): ImageData {
  const buf = new Uint8ClampedArray(size * size * 4);
  const s   = size / 16;
  const cx  = (size - 1) / 2;
  const cy  = (size - 1) / 2;
  const Ro  = 6.8 * s;   // tooth-tip radius
  const Ri  = 4.4 * s;   // tooth-root radius
  const Rh  = 1.8 * s;   // centre-hole radius
  const N   = 8;          // number of teeth
  const SLOT = (Math.PI * 2) / N;
  const [r, g, b] = recording ? [34, 197, 94] : [239, 68, 68];

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const dx   = px - cx;
      const dy   = py - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > Ro + 0.5 || dist < Rh - 0.5) continue;

      // Phase within one tooth slot (0–1); middle third → tooth tip.
      const angle = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
      const phase = (angle % SLOT) / SLOT;
      const boundary = (phase > 1 / 3 && phase < 2 / 3) ? Ro : Ri;

      if (dist > boundary + 0.5) continue;

      // Soft anti-aliased alpha at outer boundary and hole edge.
      const alpha = Math.min(
        Math.min(1, boundary + 0.5 - dist),
        Math.min(1, dist - (Rh - 0.5))
      );
      if (alpha <= 0) continue;

      const i = (py * size + px) * 4;
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b;
      buf[i + 3] = Math.round(alpha * 255);
    }
  }

  return new ImageData(buf, size, size);
}

function applyIcon(recording: boolean) {
  chrome.action.setIcon({
    imageData: {
      16: drawGearIcon(16, recording),
      48: drawGearIcon(48, recording),
    },
  });
  chrome.action.setTitle({
    title: recording ? "QA Copilot — Recording active" : "QA Copilot — Idle (click to open)",
  });
  chrome.action.setBadgeText({ text: recording ? "REC" : "" });
  if (recording) chrome.action.setBadgeBackgroundColor({ color: "#16a34a" });
}

// ── Recording lifecycle ───────────────────────────────────────────────────────

async function attachToTab(tabId: number) {
  try {
    await DebuggerSession.attach(tabId);
    ConsoleNetworkCollector.reset();
  } catch {
    // Already attached — keep collecting, don't reset.
  }
}

async function startRecording(tabId: number) {
  recordingTabId = tabId;
  await attachToTab(tabId);

  // Re-inject content scripts in case the tab was already open when the
  // extension loaded (or was reloaded). Guards inside each script prevent
  // double-registration of listeners.
  try {
    const cs = chrome.runtime.getManifest().content_scripts ?? [];
    for (const entry of cs) {
      if (entry.js?.length) {
        await chrome.scripting.executeScript({ target: { tabId }, files: entry.js }).catch(() => {});
      }
    }
  } catch { /* tab not scriptable — ignore */ }

  await chrome.storage.session.set({ recordingState: "recording", recordingTabId: tabId });
  applyIcon(true);
  chrome.runtime.sendMessage({ type: "RECORDING_STATE", recording: true }).catch(() => {});
}

async function stopRecording() {
  let tabId = recordingTabId;
  recordingTabId = null;

  // If the service worker was just evicted and restarted, the in-memory
  // recordingTabId may still be null while the async session-storage restore
  // is in flight. Read it directly so we can always detach the debugger and
  // close the browser infobar.
  if (tabId == null) {
    const stored = await chrome.storage.session.get("recordingTabId");
    tabId = (stored["recordingTabId"] as number | undefined) ?? null;
  }

  // Clear session flags before detaching so a concurrent restart can't
  // re-attach and bring the infobar back.
  chrome.storage.session.remove(["recordingState", "recordingTabId"]);

  if (tabId != null) {
    chrome.debugger.detach({ tabId }).catch(() => {});
  }

  ConsoleNetworkCollector.reset();
  applyIcon(false);
  chrome.runtime.sendMessage({ type: "RECORDING_STATE", recording: false }).catch(() => {});
}

// ── Restore state after service-worker eviction ───────────────────────────────

chrome.storage.session
  .get(["recordingState", "recordingTabId"])
  .then((result: Record<string, any>) => {
    if (result["recordingState"] === "recording" && result["recordingTabId"]) {
      recordingTabId = result["recordingTabId"] as number;
      applyIcon(true);
      void attachToTab(recordingTabId);
    } else {
      applyIcon(false);
    }
  });

// ── Tab lifecycle ─────────────────────────────────────────────────────────────

// Re-attach on full page reload within the recording tab (SPA navigations keep the debugger).
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === recordingTabId && changeInfo.status === "loading") {
    void attachToTab(tabId);
  }
});

// Stop recording automatically when the user closes the recorded tab.
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === recordingTabId) stopRecording();
});

// Re-attach if Chrome detaches the debugger (e.g. DevTools opened on the tab).
// If the user dismissed the infobar, keep the recording state alive but don't
// reattach right away — the infobar would just reappear immediately.
// CDP capture resumes automatically on the next full page navigation.
chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId && source.tabId === recordingTabId) {
    if (reason !== "canceled_by_user") {
      DebuggerSession.reattach(source.tabId);
    }
    // canceled_by_user: stay in recording state, no reattach, no infobar spam.
  }
});

// ── Extension install ─────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  void controller.ensureOffscreen();
  applyIcon(false);
});

// ── Commands + messages ───────────────────────────────────────────────────────

// Keyboard shortcut only works while recording.
chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === "capture-bug" && recordingTabId != null) {
    void controller.capture(recordingTabId);
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "CAPTURE_BUG") {
    if (recordingTabId == null) {
      sendResponse({ phase: "error", message: "Not recording — click Start Recording first." });
      return;
    }
    controller.capture(recordingTabId!).then((r) => sendResponse(r));
    return true; // async
  }

  if (msg.type === "START_RECORDING") {
    chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      if (!tab?.id) {
        sendResponse({ ok: false, error: "No active tab found." });
        return;
      }
      try {
        await startRecording(tab.id);
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    });
    return true; // async
  }

  if (msg.type === "STOP_RECORDING") {
    stopRecording().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: true }));
    return true; // async response
  }
});
