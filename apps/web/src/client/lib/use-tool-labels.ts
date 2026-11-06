/**
 * The tool label catalog (tool-call-text.ts), loaded once per page load:
 * the first transcript to mount fetches it, and every later mount starts
 * from the same catalog instead of rendering raw tool names until its own
 * request answers. A failed load is retried by the next mount.
 */
import { useEffect, useState } from "react";
import { botsApi } from "./bots-api";
import { NO_TOOL_LABELS, toolLabelCatalog, type ToolLabelCatalog } from "./tool-call-text";

let catalog: ToolLabelCatalog | undefined;
let loading: Promise<ToolLabelCatalog> | undefined;

function loadToolLabels(): Promise<ToolLabelCatalog> {
  loading ??= botsApi.capabilities().then(
    (capabilities) => (catalog = toolLabelCatalog(capabilities)),
    (error: unknown) => {
      loading = undefined;
      throw error;
    },
  );
  return loading;
}

/** Tool labels for transcript rows (past tense) and approval cards (imperative). */
export function useToolLabels(): ToolLabelCatalog {
  const [labels, setLabels] = useState(() => catalog ?? NO_TOOL_LABELS);
  useEffect(() => {
    // Loaded by another mount since this one's first render: take it (a no-op when already held).
    if (catalog) {
      setLabels(catalog);
      return;
    }
    let cancelled = false;
    loadToolLabels()
      .then((loaded) => {
        if (!cancelled) setLabels(loaded);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return labels;
}
