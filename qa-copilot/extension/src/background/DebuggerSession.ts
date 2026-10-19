import { ConsoleNetworkCollector } from "../collectors/ConsoleNetworkCollector";

// Suppress the same error message within this window to avoid toast spam.
const DEDUP_WINDOW_MS = 60_000;
const recentErrors = new Map<string, number>(); // signature → last-shown timestamp

function dedupKey(text: string): string {
  return text.slice(0, 120);
}

function isSuppressed(text: string): boolean {
  const now = Date.now();
  // Prune expired entries so the map doesn't grow unboundedly.
  for (const [k, t] of recentErrors) {
    if (now - t >= DEDUP_WINDOW_MS) recentErrors.delete(k);
  }
  const key = dedupKey(text);
  const last = recentErrors.get(key);
  if (last !== undefined && now - last < DEDUP_WINDOW_MS) return true;
  recentErrors.set(key, now);
  return false;
}

export class DebuggerSession {
  // Set to true during an active capture so toasts are suppressed.
  static capturing = false;

  static async attach(tabId: number) {
    try {
      await chrome.debugger.attach({ tabId }, "1.3");
      await chrome.debugger.sendCommand({ tabId }, "Network.enable", {});
      await chrome.debugger.sendCommand({ tabId }, "Runtime.enable", {});
      await chrome.debugger.sendCommand({ tabId }, "Log.enable", {});
      await chrome.debugger.sendCommand({ tabId }, "Page.enable", {});
    } finally {
      // Re-register even if attach threw "already attached" — the service worker
      // may have been evicted and restarted while the debugger session was live.
      // Chrome deduplicates identical listener references so this is safe to call
      // multiple times.
      chrome.debugger.onEvent.addListener(DebuggerSession.onEvent);
    }
  }

  static reattach(tabId: number) {
    void DebuggerSession.attach(tabId);
  }

  private static onEvent(
    source: chrome.debugger.Debuggee,
    method: string,
    params: unknown
  ) {
    const p = params as any;
    switch (method) {
      case "Network.requestWillBeSent":
      case "Network.responseReceived":
      case "Network.loadingFinished":
        ConsoleNetworkCollector.onNetwork(method, params);
        break;
      case "Runtime.exceptionThrown":
      case "Runtime.consoleAPICalled":
      case "Log.entryAdded":
        ConsoleNetworkCollector.onConsole(method, params);
        if (source.tabId) DebuggerSession.maybeNotify(source.tabId, method, p);
        break;
    }
  }

  private static maybeNotify(tabId: number, method: string, p: any) {
    // Don't show toasts while a capture is already in progress.
    if (DebuggerSession.capturing) return;

    let message: string | undefined;
    let src: string | undefined;
    let line: number | undefined;

    if (method === "Runtime.exceptionThrown") {
      message =
        p.exceptionDetails?.text ??
        p.exceptionDetails?.exception?.description;
      src = p.exceptionDetails?.url;
      line = p.exceptionDetails?.lineNumber;
    } else if (method === "Runtime.consoleAPICalled" && p.type === "error") {
      message = p.args
        ?.map((a: any) => a.value ?? a.description ?? "")
        .join(" ");
    } else if (method === "Log.entryAdded" && p.entry?.level === "error") {
      message = p.entry?.text;
      src = p.entry?.url;
      line = p.entry?.lineNumber;
    }

    // Skip blank/whitespace messages and errors from extension own scripts.
    if (!message?.trim()) return;
    if (src?.startsWith("chrome-extension://")) return;
    if (isSuppressed(message)) return;

    chrome.tabs
      .sendMessage(tabId, {
        type: "SILENT_ERROR_DETECTED",
        payload: { message, source: src, line },
      })
      .catch(() => {
        // Content script not present on this tab — safe to ignore.
      });
  }
}
