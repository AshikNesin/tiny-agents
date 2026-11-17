/** Phones that receive notifications (issue #306): the devices the Android app registered. */
import { apiClient } from "@groot/shell/lib/api";
import type { PushDeviceList, PushDeviceRemoved, PushDeviceTest } from "../../shared/api/push";

export const pushApi = {
  devices: () => apiClient.get<PushDeviceList>("/notifications/devices"),
  test: (id: string) => apiClient.post<PushDeviceTest>(`/notifications/devices/${id}/test`),
  remove: (id: string) => apiClient.delete<PushDeviceRemoved>(`/notifications/devices/${id}`),
};
