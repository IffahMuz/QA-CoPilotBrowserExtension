interface SilentErrorPayload {
  message: string;
  source?: string;
  line?: number;
}

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

let toastHost: HTMLElement | null = null;

function removeToast() {
  toastHost?.remove();
  toastHost = null;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const STYLES = `
  .toast {
    background: #1e1e2e;
    color: #cdd6f4;
    border: 1px solid #45475a;
    border-left: 4px solid #f38ba8;
    border-radius: 8px;
    width: 340px;
    box-sizing: border-box;
    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    font-family: ${FONT};
    animation: slideIn 0.2s ease-out;
    overflow: hidden;
  }
  @keyframes slideIn {
    from { transform: translateX(110%); opacity: 0; }
    to   { transform: translateX(0);    opacity: 1; }
  }

  /* Top section — always visible */
  .top { padding: 14px 14px 0 14px; }

  .header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .icon { font-size: 15px; }
  .title { font-weight: 600; font-size: 13px; color: #f38ba8; }
  .subtitle { font-size: 12px; color: #a6adc8; line-height: 1.45; margin-bottom: 10px; }

  /* Expandable details — collapses/expands with max-height */
  .details {
    max-height: 0;
    overflow: hidden;
    transition: max-height 0.3s ease-out;
  }
  /*
   * Expanded: fill from current bottom edge up to ~20px from the top of the
   * viewport.  The toast is pinned at bottom:20px; the fixed header (~65px)
   * and actions bar (~48px) account for the rest of the non-details height,
   * so 20px (top gap) + 20px (bottom gap) + 113px (fixed parts) ≈ 153px.
   */
  .details.open {
    max-height: calc(100vh - 155px);
    overflow-y: auto;
  }

  .details-inner {
    border-top: 1px solid #313244;
    padding: 12px 14px 14px 14px;
  }
  .section-label {
    font-size: 10px;
    font-weight: 700;
    color: #6c7086;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 6px;
  }
  .error-box {
    background: #11111b;
    border: 1px solid #313244;
    border-radius: 5px;
    padding: 10px 12px;
    font-family: 'Courier New', monospace;
    font-size: 11px;
    color: #cdd6f4;
    white-space: pre-wrap;
    word-break: break-all;
    line-height: 1.55;
    margin-bottom: 10px;
  }
  .loc {
    font-size: 11px;
    color: #585b70;
    font-family: 'Courier New', monospace;
    margin-bottom: 4px;
    word-break: break-all;
  }

  /* Bottom actions — always visible */
  .actions {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 10px 14px 12px 14px;
    border-top: 1px solid #1e1e2e;
  }
  button {
    cursor: pointer;
    border: none;
    border-radius: 5px;
    padding: 5px 11px;
    font-size: 12px;
    font-weight: 500;
    font-family: ${FONT};
    transition: opacity 0.15s;
  }
  button:hover { opacity: 0.8; }
  .btn-details { background: #313244; color: #cdd6f4; }
  .btn-capture { background: #cba6f7; color: #1e1e2e; }
  .btn-dismiss {
    background: transparent;
    color: #585b70;
    margin-left: auto;
    padding: 2px 4px;
    font-size: 16px;
    line-height: 1;
  }
`;

// ── Toast builder ─────────────────────────────────────────────────────────────

function showToast(payload: SilentErrorPayload) {
  removeToast();

  const host = document.createElement("div");
  host.style.cssText =
    "all:unset;position:fixed!important;bottom:20px;right:20px;" +
    "z-index:2147483647;width:340px;";
  const shadow = host.attachShadow({ mode: "open" });

  const styleEl = document.createElement("style");
  styleEl.textContent = STYLES;

  const toast = document.createElement("div");
  toast.className = "toast";

  // ── Top (always visible) ──────────────────────────────────────────────────
  const top = document.createElement("div");
  top.className = "top";

  const header = document.createElement("div");
  header.className = "header";
  header.innerHTML = `<span class="icon">⚠️</span><span class="title">Silent Issue Detected</span>`;

  const btnDismissTop = document.createElement("button");
  btnDismissTop.className = "btn-dismiss";
  btnDismissTop.title = "Dismiss";
  btnDismissTop.textContent = "✕";
  btnDismissTop.addEventListener("click", removeToast);
  header.appendChild(btnDismissTop);

  const subtitle = document.createElement("div");
  subtitle.className = "subtitle";
  subtitle.textContent = "We detected a console error that may indicate an issue.";

  top.append(header, subtitle);

  // ── Expandable details ────────────────────────────────────────────────────
  const details = document.createElement("div");
  details.className = "details";

  const inner = document.createElement("div");
  inner.className = "details-inner";

  const msgLabel = document.createElement("div");
  msgLabel.className = "section-label";
  msgLabel.textContent = "Error Message";

  const errorBox = document.createElement("div");
  errorBox.className = "error-box";
  errorBox.textContent = payload.message;

  inner.append(msgLabel, errorBox);

  if (payload.source || payload.line != null) {
    const loc = document.createElement("div");
    loc.className = "loc";
    loc.textContent =
      `@ ${payload.source ?? ""}${payload.line != null ? `:${payload.line}` : ""}`;
    inner.appendChild(loc);
  }

  details.appendChild(inner);

  // ── Actions (always visible) ──────────────────────────────────────────────
  const actions = document.createElement("div");
  actions.className = "actions";

  const btnDetails = document.createElement("button");
  btnDetails.className = "btn-details";
  btnDetails.textContent = "View Details";
  let expanded = false;
  btnDetails.addEventListener("click", () => {
    expanded = !expanded;
    details.classList.toggle("open", expanded);
    btnDetails.textContent = expanded ? "Hide Details" : "View Details";
  });

  const btnCapture = document.createElement("button");
  btnCapture.className = "btn-capture";
  btnCapture.textContent = "Capture Issue";
  btnCapture.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "CAPTURE_BUG" }).catch(() => {});
    removeToast();
  });

  actions.append(btnDetails, btnCapture);

  toast.append(top, details, actions);
  shadow.append(styleEl, toast);

  (document.body ?? document.documentElement).appendChild(host);
  toastHost = host;
}

// ── Message listener ──────────────────────────────────────────────────────────
// Guard: the background re-injects this script into already-open tabs when
// recording starts. Only register the listener once per page context.

if (!(window as any).__qacSilentLoaded) {
  (window as any).__qacSilentLoaded = true;

  chrome.runtime.onMessage.addListener((msg: unknown) => {
    if (
      typeof msg === "object" &&
      msg !== null &&
      (msg as { type?: string }).type === "SILENT_ERROR_DETECTED"
    ) {
      showToast((msg as { type: string; payload: SilentErrorPayload }).payload);
    }
  });
}
