import { useMemo } from "react";
import { useCapabilities } from "../queries/capabilities";
import { NO_TOOL_LABELS, toolLabelCatalog, type ToolLabelCatalog } from "./tool-call-text";

export function useToolLabels(): ToolLabelCatalog {
  const capabilities = useCapabilities("Failed to load tool labels");
  const known =
    capabilities.status === "ready"
      ? capabilities.data
      : capabilities.status === "failed"
        ? capabilities.last
        : undefined;
  return useMemo(() => (known ? toolLabelCatalog(known) : NO_TOOL_LABELS), [known]);
}
