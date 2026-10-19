interface NavEntry {
  url: string;
  timestamp: number;
  tabId: number;
}

export class NavigationLog {
  private static entries_: NavEntry[] = [];
  private static landedAt_ = new Map<number, number>();

  static init() {
    chrome.webNavigation.onCommitted.addListener((details) => {
      if (details.frameId === 0) {
        const now = Date.now();
        NavigationLog.entries_.push({ url: details.url, timestamp: now, tabId: details.tabId });
        NavigationLog.landedAt_.set(details.tabId, now);
      }
    });
  }

  static entries(tabId?: number): NavEntry[] {
    const all = [...NavigationLog.entries_];
    return tabId != null ? all.filter((e) => e.tabId === tabId) : all;
  }

  static landedAt(tabId?: number): number {
    if (tabId != null) {
      return NavigationLog.landedAt_.get(tabId) ?? Date.now();
    }
    let latest = 0;
    for (const t of NavigationLog.landedAt_.values()) {
      if (t > latest) latest = t;
    }
    return latest || Date.now();
  }
}
