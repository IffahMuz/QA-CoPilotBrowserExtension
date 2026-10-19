export interface HarDocument {
  log: {
    version: string;
    creator: { name: string; version: string };
    entries: any[];
  };
}

export class HarBuilder {
  private requests = new Map<string, any>();
  private responses = new Map<string, any>();

  consume(method: string, params: any) {
    if (method === "Network.requestWillBeSent") {
      this.requests.set(params.requestId, params);
    } else if (method === "Network.responseReceived") {
      this.responses.set(params.requestId, params);
    }
  }

  build(): HarDocument {
    const entries: any[] = [];
    for (const [id, req] of this.requests) {
      const res = this.responses.get(id);
      entries.push({
        _requestId: id,
        startedDateTime: new Date(req.wallTime * 1000).toISOString(),
        time: 0,
        request: {
          method: req.request.method,
          url: req.request.url,
          headers: Object.entries(req.request.headers ?? {}).map(([name, value]) => ({ name, value })),
          postData: req.request.postData ? { text: req.request.postData } : undefined,
        },
        response: res
          ? {
              status: res.response.status,
              statusText: res.response.statusText,
              headers: Object.entries(res.response.headers ?? {}).map(([name, value]) => ({ name, value })),
              content: { size: res.response.encodedDataLength ?? 0, mimeType: res.response.mimeType },
            }
          : { status: 0, statusText: "", headers: [], content: { size: 0, mimeType: "" } },
      });
    }
    return {
      log: {
        version: "1.2",
        creator: { name: "qa-copilot", version: "0.1.0" },
        entries,
      },
    };
  }
}
