/** The Traces page's resources (issue #363): the 7-day summary, a list's first page, one session. */
import type { TraceSessionFilter } from "../../shared/api/traces";
import { tracesApi } from "../lib/traces-api";
import { useResource } from "./resource";

/** What the list shows: sessions (all, or one kind) or side-calls. */
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
