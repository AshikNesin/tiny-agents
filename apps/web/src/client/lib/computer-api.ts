import { apiClient } from "@groot/shell/lib/api";
import type {
  DesktopApps,
  DesktopList,
  DriverBody,
  LiveStarting,
  OpenAppBody,
  VncTicket,
} from "../../shared/api/live";

const path = (profile: string) => `/computer/${encodeURIComponent(profile)}`;

export const computerApi = {
  list: () => apiClient.get<DesktopList>("/computer"),
  start: (profile: string) => apiClient.post<LiveStarting>(`${path(profile)}/start`),
  ticket: (profile: string) => apiClient.post<VncTicket>(`${path(profile)}/vnc-ticket`),
  driver: (profile: string, driver: DriverBody["driver"]) =>
    apiClient.post(`${path(profile)}/driver`, { driver } satisfies DriverBody),
  apps: (profile: string) => apiClient.get<DesktopApps>(`${path(profile)}/apps`),
  openApp: (profile: string, id: string) =>
    apiClient.post(`${path(profile)}/apps`, { id } satisfies OpenAppBody),
  reset: (profile: string) => apiClient.delete(path(profile)),
};
