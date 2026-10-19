export class ScreenshotCollector {
  async snapshot(tabId: number) {
    const tab = await chrome.tabs.get(tabId);
    const viewport = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const full = (await chrome.debugger.sendCommand(
      { tabId },
      "Page.captureScreenshot",
      { captureBeyondViewport: true, fromSurface: true, format: "png" }
    )) as { data: string };
    return {
      viewportPng: viewport,
      fullPagePng: `data:image/png;base64,${full.data}`,
    };
  }
}
