import { botsApi } from "../lib/bots-api";
import { toolLabelCatalog } from "../lib/tool-call-text";
import { useResource } from "./resource";

export const useToolLabelCatalog = () =>
  useResource(
    ["tool-labels"],
    async () => toolLabelCatalog(await botsApi.capabilities()),
    "Failed to load tool labels",
    { staleTime: Infinity, gcTime: Infinity },
  );
