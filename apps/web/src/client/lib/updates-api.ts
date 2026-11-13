/** Local self-updates (docs/guides/local-updates.md): status, check, update & restart. */
import { apiClient } from "@groot/shell/lib/api";
import type { UpdateView } from "../../shared/local-updates";

export const updatesApi = {
  get: () => apiClient.get<UpdateView>("/system/update"),
  check: () => apiClient.post<UpdateView>("/system/update/check"),
  apply: () => apiClient.post<UpdateView>("/system/update/apply"),
};
