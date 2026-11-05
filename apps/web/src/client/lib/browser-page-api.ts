/**
 * The Browser page's API (issue #160): the bots' browsers by profile
 * (`shared`, `bot-<id>`), not by bot. See `browser.page.routes.ts`.
 */
import { apiClient } from "@groot/shell/lib/api";
import type { VncTicket } from "../components/browser/VncView";

/** One browser: who uses it and how it stands. */
export interface PageBrowser {
  profile: string;
  /** "Shared", or the name of the bot with a browser of its own. */
  label: string;
  bots: { id: string; name: string }[];
  active: boolean;
  driver: "agent" | "human" | null;
  /** `vnc` streams; `headless` runs without a display. Null while closed. */
  mode: "vnc" | "headless" | null;
  starting: boolean;
  phase: "installing" | "starting" | null;
  error: string | null;
}

export interface PageBrowserList {
  /** False when this server's browsers run headless (no sandbox VM). */
  liveView: boolean;
  setupHint: string | null;
  browsers: PageBrowser[];
}

const path = (profile: string) => `/browser/${encodeURIComponent(profile)}`;

export const browserPageApi = {
  list: () => apiClient.get<PageBrowserList>("/browser"),
  start: (profile: string) => apiClient.post<{ starting: boolean }>(`${path(profile)}/start`),
  ticket: (profile: string) => apiClient.post<VncTicket>(`${path(profile)}/vnc-ticket`),
  resize: (profile: string, size: { width: number; height: number }) =>
    apiClient.post(`${path(profile)}/resize`, size),
  driver: (profile: string, driver: "agent" | "human") =>
    apiClient.post(`${path(profile)}/driver`, { driver }),
  reset: (profile: string) => apiClient.delete(path(profile)),
};
