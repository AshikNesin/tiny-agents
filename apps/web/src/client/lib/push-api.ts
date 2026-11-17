/** Phones that receive notifications (issue #306): the devices the Android app registered. */
import { apiClient } from "@groot/shell/lib/api";
import type {
  NotificationChannelSettings,
  PushDeviceList,
  PushDeviceRemoved,
  PushDeviceTest,
} from "../../shared/api/push";

export const pushApi = {
  devices: () => apiClient.get<PushDeviceList>("/notifications/devices"),
  test: (id: string) => apiClient.post<PushDeviceTest>(`/notifications/devices/${id}/test`),
  remove: (id: string) => apiClient.delete<PushDeviceRemoved>(`/notifications/devices/${id}`),
  settings: () => apiClient.get<NotificationChannelSettings>("/notifications/settings"),
  saveSettings: (settings: NotificationChannelSettings["settings"]) =>
    apiClient.put<NotificationChannelSettings>("/notifications/settings", settings),
};
