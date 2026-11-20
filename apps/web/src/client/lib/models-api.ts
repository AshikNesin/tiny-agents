import { apiClient } from "@groot/shell/lib/api";
import type { Deleted } from "../../shared/api/common";
import type {
  Account,
  AccountConnectionBody,
  AccountCreateBody,
  AccountList,
  AccountModel,
  AccountPatchBody,
  AccountRefresh,
  DiscoveredModels,
  ModelAddBody,
  ModelEndpoint,
  ModelPatchBody,
  ModelTestBody,
  ModelTestResult,
  RolesBody,
  RolesResponse,
} from "../../shared/api/models";
import { stepped } from "./vault-api";

export const modelsApi = {
  accounts: () => apiClient.get<AccountList>("/models/providers"),
  discover: (connection: ModelEndpoint) =>
    apiClient.post<DiscoveredModels>("/models/discover", connection),
  create: (input: AccountCreateBody) => stepped<Account>("post", "/models/providers", input),
  patch: (account: Account, input: AccountPatchBody) =>
    apiClient.request<Account>("patch", `/models/providers/${account.id}`, {
      body: input,
      headers: { "If-Match": String(account.version) },
    }),
  updateConnection: (id: string, input: AccountConnectionBody) =>
    stepped<Account>("put", `/models/providers/${id}/connection`, input),
  available: (id: string) => apiClient.get<DiscoveredModels>(`/models/providers/${id}/available`),
  refresh: (id: string) => apiClient.post<AccountRefresh>(`/models/providers/${id}/refresh`),
  remove: (id: string, moveTo?: string) =>
    stepped<Deleted>(
      "delete",
      `/models/providers/${id}${moveTo ? `?moveTo=${encodeURIComponent(moveTo)}` : ""}`,
    ),
  addModel: (accountId: string, input: ModelAddBody) =>
    apiClient.post<AccountModel>(`/models/providers/${accountId}/models`, input),
  patchModel: (id: string, input: ModelPatchBody) =>
    apiClient.request<AccountModel>("patch", `/models/${id}`, { body: input }),
  removeModel: (id: string, moveTo?: string) =>
    apiClient.request<Deleted>(
      "delete",
      `/models/${id}${moveTo ? `?moveTo=${encodeURIComponent(moveTo)}` : ""}`,
      { emptyOk: true },
    ),
  test: (input: ModelTestBody) => apiClient.post<ModelTestResult>("/models/test", input),
  roles: () => apiClient.get<RolesResponse>("/models/roles"),
  setRoles: (input: RolesBody) =>
    apiClient.request<RolesResponse>("put", "/models/roles", { body: input }),
};
