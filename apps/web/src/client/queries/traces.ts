import type { TraceSessionFilter } from "../../shared/api/traces";
import { tracesApi } from "../lib/traces-api";
import { useResource } from "./resource";

export type TraceListFilter = TraceSessionFilter | "all" | "side";

export const useTraceSummary = () =>
  useResource(["traces", "summary"], () => tracesApi.summary(), "Failed to load the summary");

export const useTraceList = (filter: TraceListFilter) =>
  useResource(
    ["traces", "list", filter],
    async () =>
      filter === "side"
        ? { kind: "side" as const, ...(await tracesApi.sideCalls({})) }
        : {
            kind: "sessions" as const,
            ...(await tracesApi.sessions(filter === "all" ? {} : { kind: filter })),
          },
    "Failed to load traces",
  );

export const useTraceSession = (id: string) =>
  useResource(["traces", "session", id], () => tracesApi.session(id), "Failed to load this trace");
