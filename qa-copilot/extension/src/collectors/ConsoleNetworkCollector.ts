import { HarBuilder } from "./HarBuilder";

export interface ConsoleEntry {
  level: string;
  text: string;
  timestamp: number;
  stack?: unknown;
  source?: string;
  line?: number;
}

export class ConsoleNetworkCollector {
  private static console: ConsoleEntry[] = [];
  private static har = new HarBuilder();
  private static readonly HIGHLIGHT = [400, 401, 403, 404, 409, 422, 500];

  static onConsole(method: string, p: any) {
    let entry: ConsoleEntry;
    if (method === "Runtime.exceptionThrown") {
      entry = {
        level: "error",
        text: p.exceptionDetails?.text ?? p.exceptionDetails?.exception?.description ?? "exception",
        timestamp: Date.now(),
        stack: p.exceptionDetails?.stackTrace,
        source: p.exceptionDetails?.url,
        line: p.exceptionDetails?.lineNumber,
      };
    } else if (method === "Runtime.consoleAPICalled") {
      entry = {
        level: p.type ?? "log",
        text: p.args?.map((a: any) => a.value ?? a.description ?? "").join(" ") ?? "",
        timestamp: Date.now(),
        stack: p.stackTrace,
      };
    } else {
      // Log.entryAdded
      entry = {
        level: p.entry?.level ?? "info",
        text: p.entry?.text ?? "",
        timestamp: Date.now(),
        source: p.entry?.url,
        line: p.entry?.lineNumber,
      };
    }
    ConsoleNetworkCollector.console.push(entry);
  }

  static onNetwork(method: string, p: any) {
    ConsoleNetworkCollector.har.consume(method, p);
  }

  static snapshot() {
    const har = ConsoleNetworkCollector.har.build();
    har.log.entries.forEach((e: any) => {
      e._failed =
        e.response &&
        ConsoleNetworkCollector.HIGHLIGHT.includes(e.response.status);
    });
    return {
      console: [...ConsoleNetworkCollector.console],
      network: har,
    };
  }

  static reset() {
    ConsoleNetworkCollector.console = [];
    ConsoleNetworkCollector.har = new HarBuilder();
  }
}
