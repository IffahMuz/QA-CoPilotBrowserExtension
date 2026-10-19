// Best-effort DOM probes — run in content script context via scripting.executeScript
export const DomProbeScript = {
  detectUser: () => {
    const selectors = [
      "[data-user]",
      "[data-username]",
      ".user-name",
      "#user-display-name",
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el.textContent?.trim() ?? null;
    }
    return null;
  },

  detectModule: () => {
    const breadcrumb = document.querySelector(".breadcrumb, [aria-label='breadcrumb']");
    if (breadcrumb) return breadcrumb.textContent?.trim().slice(0, 60) ?? null;
    const h1 = document.querySelector("h1");
    return h1?.textContent?.trim().slice(0, 60) ?? null;
  },

  featureFlags: (): Record<string, unknown> => {
    try {
      const raw =
        (window as any).__featureFlags ??
        (window as any).featureFlags ??
        {};
      return typeof raw === "object" ? raw : {};
    } catch {
      return {};
    }
  },

  userRoles: (): string[] => {
    try {
      const raw =
        (window as any).__userRoles ??
        (window as any).userRoles ??
        [];
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  },
};
