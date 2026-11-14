/**
 * The Browser page's API (issue #160): the bots' browsers by profile
 * (`shared`, `bot-<id>`), not by bot. See `server/api/live/live.routes.ts`;
 * the shapes are `shared/api/live.ts`.
 */
import { apiClient } from "@groot/shell/lib/api";
import type {
  DriverBody,
  LiveStarting,
  PageBrowserList,
  ResizeBody,
  VncTicket,
} from "../../shared/api/live";

const path = (profile: string) => `/browser/${encodeURIComponent(profile)}`;

export const browserPageApi = {
  list: () => apiClient.get<PageBrowserList>("/browser"),
  start: (profile: string) => apiClient.post<LiveStarting>(`${path(profile)}/start`),
  ticket: (profile: string) => apiClient.post<VncTicket>(`${path(profile)}/vnc-ticket`),
  resize: (profile: string, size: ResizeBody) => apiClient.post(`${path(profile)}/resize`, size),
  driver: (profile: string, driver: DriverBody["driver"]) =>
    apiClient.post(`${path(profile)}/driver`, { driver } satisfies DriverBody),
  reset: (profile: string) => apiClient.delete(path(profile)),
};
