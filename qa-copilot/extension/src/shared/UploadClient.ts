import type { EvidencePackage } from "./EvidencePackage";

export class UploadClient {
  constructor(private baseUrl: string) {}

  async upload(pkg: EvidencePackage): Promise<{ report_id: number; status: string }> {
    const form = new FormData();
    const { screenshot, video, network, ...inline } = pkg as any;

    form.append(
      "package",
      new Blob(
        [JSON.stringify({ ...inline, screenshot: "ref", video: "ref" })],
        { type: "application/json" }
      )
      // intentionally no filename — backend skips files with empty names
    );

    form.append(
      "har",
      new Blob([JSON.stringify(network)], { type: "application/json" }),
      "network.har"
    );

    // Convert data: URL to Blob without fetch — reliable in service workers.
    if (screenshot?.fullPagePng) {
      form.append("screenshot", this.dataUrlToBlob(screenshot.fullPagePng), "screenshot.png");
    } else if (screenshot?.viewportPng) {
      form.append("screenshot", this.dataUrlToBlob(screenshot.viewportPng), "screenshot.png");
    }

    if (video instanceof Blob && video.size > 0) {
      form.append("video", video, "video.webm");
    }

    const res = await fetch(`${this.baseUrl}/api/evidence`, {
      method: "POST",
      body: form,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Upload ${res.status}: ${text}`);
    }

    return res.json();
  }

  private dataUrlToBlob(dataUrl: string): Blob {
    const comma = dataUrl.indexOf(",");
    const meta = dataUrl.slice(0, comma);
    const b64 = dataUrl.slice(comma + 1);
    const mime = meta.match(/:(.*?);/)?.[1] ?? "image/png";
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new Blob([bytes], { type: mime });
  }
}
