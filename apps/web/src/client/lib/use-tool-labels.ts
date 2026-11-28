import { useToolLabelCatalog } from "../queries/tool-labels";
import { NO_TOOL_LABELS, type ToolLabelCatalog } from "./tool-call-text";

export function useToolLabels(): ToolLabelCatalog {
  const catalog = useToolLabelCatalog();
  if (catalog.status === "ready") return catalog.data;
  return (catalog.status === "failed" ? catalog.last : undefined) ?? NO_TOOL_LABELS;
}
