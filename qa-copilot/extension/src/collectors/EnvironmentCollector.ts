import { CookieProbe } from "./CookieProbe";

export class EnvironmentCollector {
  async snapshot(tabId: number, tabUrl: string) {
    let localStorage_: Record<string, string> = {};
    let sessionStorage_: Record<string, string> = {};
    let featureFlags: Record<string, unknown> = {};
    let roles: string[] = [];

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => ({
          ls: { ...window.localStorage },
          ss: { ...window.sessionStorage },
          flags: (() => { try { return (window as any).__featureFlags ?? {}; } catch { return {}; } })(),
          roles: (() => { try { return (window as any).__userRoles ?? []; } catch { return []; } })(),
        }),
      });
      const data = results[0]?.result as any;
      if (data) {
        localStorage_ = data.ls;
        sessionStorage_ = data.ss;
        featureFlags = data.flags;
        roles = data.roles;
      }
    } catch {
      // page not injectable
    }

    const { cookies, removedNames: removedCookieNames } = await CookieProbe.filtered(tabUrl).catch(
      () => ({ cookies: [], removedNames: [] })
    );

    return {
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      localStorage: localStorage_,
      sessionStorage: sessionStorage_,
      cookies,
      removedCookieNames,
      featureFlags,
      roles,
    };
  }
}
