// Guard against double-registration when the background re-injects this script.
if ((window as any).__qacActionsLoaded) throw new Error("__qacActionsLoaded");
(window as any).__qacActionsLoaded = true;

const SENSITIVE = /pass|token|secret|ssn|card|cvv|pin/i;
const steps: string[] = [];

function label(el: HTMLElement): string {
  return (
    el.getAttribute("aria-label") ??
    el.getAttribute("name") ??
    (el as HTMLInputElement).placeholder ??
    el.textContent?.trim().slice(0, 40) ??
    el.tagName
  );
}

document.addEventListener(
  "click",
  (e) => {
    const el = e.target as HTMLElement;
    steps.push(`${steps.length + 1}. Click "${label(el)}"`);
  },
  true
);

document.addEventListener(
  "dblclick",
  (e) => {
    const el = e.target as HTMLElement;
    steps.push(`${steps.length + 1}. Double-click "${label(el)}"`);
  },
  true
);

document.addEventListener(
  "change",
  (e) => {
    const el = e.target as HTMLInputElement;
    if (el.type === "file") return;
    const isSensitive = SENSITIVE.test(el.name + el.id + el.type);
    const value = isSensitive ? "••••• (masked)" : el.value?.slice(0, 40);
    const tag = el.tagName.toLowerCase();
    if (tag === "select") {
      steps.push(`${steps.length + 1}. Select "${label(el)}" = ${value}`);
    } else if (el.type === "checkbox" || el.type === "radio") {
      steps.push(`${steps.length + 1}. Toggle "${label(el)}" = ${el.checked}`);
    } else {
      steps.push(`${steps.length + 1}. Set "${label(el)}" = ${value}`);
    }
  },
  true
);

document.addEventListener(
  "keydown",
  (e) => {
    if (["Enter", "Tab", "Escape"].includes(e.key)) {
      steps.push(`${steps.length + 1}. Key "${e.key}"`);
    }
  },
  true
);

document.addEventListener(
  "change",
  (e) => {
    const el = e.target as HTMLInputElement;
    if (el.type === "file" && el.files?.length) {
      const names = Array.from(el.files)
        .map((f) => f.name)
        .join(", ");
      steps.push(`${steps.length + 1}. Upload "${label(el)}" = [${names}]`);
    }
  },
  true
);

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  if (msg.type === "SNAPSHOT_ACTIONS") {
    send({ steps: [...steps] });
    steps.length = 0; // clear so next capture gets only fresh actions
  }
});
