import { NavigationLog } from "./NavigationLog";
import { DomProbeScript } from "./DomProbe";

export class SessionCollector {
  async snapshot(tab: chrome.tabs.Tab) {
    let loggedInUser: string | null = null;
    let currentModule: string | null = null;
    let featureFlags: Record<string, unknown> = {};
    let userRoles: string[] = [];

    if (tab.id) {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => ({
            user: (() => {
              const selectors = ["[data-user]", "[data-username]", ".user-name", "#user-display-name"];
              for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el) return el.textContent?.trim() ?? null;
              }
              return null;
            })(),
            module: (() => {
              const b = document.querySelector(".breadcrumb, [aria-label='breadcrumb']");
              if (b) return b.textContent?.trim().slice(0, 60) ?? null;
              return document.querySelector("h1")?.textContent?.trim().slice(0, 60) ?? null;
            })(),
            flags: (() => {
              try { return (window as any).__featureFlags ?? (window as any).featureFlags ?? {}; } catch { return {}; }
            })(),
            roles: (() => {
              try { return (window as any).__userRoles ?? (window as any).userRoles ?? []; } catch { return []; }
            })(),
          }),
        });
        const data = results[0]?.result as any;
        if (data) {
          loggedInUser = data.user;
          currentModule = data.module;
          featureFlags = data.flags;
          userRoles = data.roles;
        }
      } catch {
        // scripting not available on this page
      }
    }

    const url = tab.url ?? "";
    return {
      url,
      environment: detectEnvironment(url),
      dealerId: extractDealerId(url, loggedInUser),
      navigationHistory: NavigationLog.entries(tab.id),
      browser: navigator.userAgent,
      os: navigator.platform,
      resolution: `${tab.width ?? 0}x${tab.height ?? 0}`,
      viewport: `${tab.width ?? 0}x${tab.height ?? 0}`,
      timeOnPageMs: Date.now() - NavigationLog.landedAt(tab.id),
      loggedInUser,
      currentModule,
      featureFlags,
      userRoles,
    };
  }
}

function detectEnvironment(url: string): string {
  if (!url) return "Unknown";
  const host = new URL(url).hostname;
  if (host.startsWith("test-")) return "Test";
  if (host.startsWith("dev-") || host.includes("localhost")) return "Development";
  if (host.startsWith("staging-")) return "Staging";
  // plain dms.targetdealer.com with no env prefix → production
  return "Production";
}

function extractDealerId(url: string, _loggedInUser: string | null): string | null {
  // Match 6–10 digit segment anywhere in the URL path, e.g. /dealers/99301001/
  const m = url.match(/\/(\d{6,10})(?:\/|$|\?|#)/);
  return m ? m[1] : null;
}
