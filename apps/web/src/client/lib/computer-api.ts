/**
 * The Computer page's API: the desktops on the sandbox VM by profile
 * (`shared`, `bot-<id>`), not by bot. See `computer.page.routes.ts`.
 */
import { apiClient } from "@groot/shell/lib/api";
import type { VncTicket } from "../components/browser/VncView";

/** One desktop: who uses it and how it stands. */
export interface Desktop {
  profile: string;
  /** "Shared", or the name of the bot with a desktop of its own. */
  label: string;
  bots: { id: string; name: string }[];
  active: boolean;
  driver: "agent" | "human" | null;
  /** What a bot asked the owner to do, while it waits for a hand-back. */
  takeover: string | null;
  starting: boolean;
  phase: "installing" | "starting" | null;
  error: string | null;
}

export interface DesktopList {
  configured: boolean;
  setupHint: string | null;
  width: number | null;
  height: number | null;
  desktops: Desktop[];
}

export interface DesktopApp {
  id: string;
  name: string;
}

const path = (profile: string) => `/computer/${encodeURIComponent(profile)}`;

export const computerApi = {
  list: () => apiClient.get<DesktopList>("/computer"),
  start: (profile: string) => apiClient.post<{ starting: boolean }>(`${path(profile)}/start`),
  ticket: (profile: string) => apiClient.post<VncTicket>(`${path(profile)}/vnc-ticket`),
  driver: (profile: string, driver: "agent" | "human") =>
    apiClient.post(`${path(profile)}/driver`, { driver }),
  apps: (profile: string) => apiClient.get<{ apps: DesktopApp[] }>(`${path(profile)}/apps`),
  openApp: (profile: string, id: string) => apiClient.post(`${path(profile)}/apps`, { id }),
  reset: (profile: string) => apiClient.delete(path(profile)),
};
