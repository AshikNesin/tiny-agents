import { apiClient } from "@groot/shell/lib/api";
import type {
  SideCallList,
  TraceSessionDetail,
  TraceSessionFilter,
  TraceSessionList,
  TraceSummary,
} from "../../shared/api/traces";

export const tracesApi = {
  summary: () => apiClient.get<TraceSummary>("/traces/summary"),
  sessions: (query: { kind?: TraceSessionFilter; before?: number }) =>
    apiClient.get<TraceSessionList>("/traces/sessions", query),
  session: (id: string) => apiClient.get<TraceSessionDetail>(`/traces/sessions/${id}`),
  sideCalls: (query: { before?: number }) =>
    apiClient.get<SideCallList>("/traces/side-calls", query),
};
