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

export function useToolLabels(): ToolLabelCatalog {
  const [labels, setLabels] = useState(() => catalog ?? NO_TOOL_LABELS);
  useEffect(() => {
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
