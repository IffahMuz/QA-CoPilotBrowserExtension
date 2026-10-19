import type { ConsoleEntry } from "../collectors/ConsoleNetworkCollector";
import type { HarDocument } from "../collectors/HarBuilder";
import type { RedactionReport } from "../redaction/RedactionPipeline";
import type { FilteredCookie } from "../collectors/CookieProbe";

export interface SessionInfo {
  url: string;
  navigationHistory: { url: string; timestamp: number }[];
  browser: string;
  os: string;
  resolution: string;
  viewport: string;
  timeOnPageMs: number;
  loggedInUser: string | null;
  currentModule: string | null;
  featureFlags: Record<string, unknown>;
  userRoles: string[];
}

export interface EnvironmentInfo {
  language: string;
  timezone: string;
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  cookies: FilteredCookie[];
  removedCookieNames: string[];
  featureFlags: Record<string, unknown>;
  roles: string[];
}

export interface EvidencePackage {
  capture_id: string;
  captured_at: string;
  session: SessionInfo;
  environment: EnvironmentInfo;
  actions: string[];
  console: ConsoleEntry[];
  network: HarDocument;
  screenshot: { viewportPng: string; fullPagePng: string };
  video?: Blob;
  redaction_report?: RedactionReport;
}
