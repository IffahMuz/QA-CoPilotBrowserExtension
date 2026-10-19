export interface RedactionReport {
  maskedFields: string[];
  strippedBodies: number;
  removedCookies: string[];
}

export class RedactionPipeline {
  private static SECRET_KEY = /pass|token|secret|key|auth|ssn|card|cvv/i;
  private static PII = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b|\b\d{3}-\d{2}-\d{4}\b/g;

  run(pkg: any): { pkg: any; report: RedactionReport } {
    const report: RedactionReport = {
      maskedFields: [],
      strippedBodies: 0,
      removedCookies: [],
    };

    // Storage: drop secret-looking keys.
    for (const store of [
      pkg.environment?.localStorage,
      pkg.environment?.sessionStorage,
    ]) {
      if (!store) continue;
      for (const k of Object.keys(store)) {
        if (RedactionPipeline.SECRET_KEY.test(k)) {
          delete store[k];
          report.maskedFields.push(k);
        }
      }
    }

    // Cookies: names of httpOnly/secure cookies stripped by CookieProbe upstream.
    if (Array.isArray(pkg.environment?.removedCookieNames)) {
      report.removedCookies = [...pkg.environment.removedCookieNames];
    }

    // Network: strip auth/token request bodies; scrub PII from URLs/headers.
    const entries: any[] = pkg.network?.log?.entries ?? [];
    for (const entry of entries) {
      if (this.shouldStripBody(entry)) {
        delete entry.request?.postData;
        if (entry.response?.content) delete entry.response.content.text;
        report.strippedBodies++;
      }
      if (entry.request?.url) {
        entry.request.url = entry.request.url.replace(
          RedactionPipeline.PII,
          "[redacted]"
        );
      }
    }

    pkg.redaction_report = report;
    return { pkg, report };
  }

  private shouldStripBody(entry: any): boolean {
    return /auth|login|token/i.test(entry.request?.url ?? "");
  }
}
