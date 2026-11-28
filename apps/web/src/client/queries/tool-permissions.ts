import { useQueryClient } from "@tanstack/react-query";
import type { ToolPermission, ToolPermissionsData } from "../../shared/api/bots";
import { botsApi } from "../lib/bots-api";
import { useCapabilities } from "./capabilities";
import { useResource } from "./resource";

const TOOL_PERMISSIONS_KEY = ["tool-permissions"] as const;

export const useToolPermissions = (enabled = true) =>
  useResource(TOOL_PERMISSIONS_KEY, () => botsApi.toolPermissions(), "Failed to load tools", {
    enabled,
  });

export const useToolkits = () => useCapabilities("Failed to load tools");

export function useSaveToolPermissions() {
  const client = useQueryClient();
  return async (permissions: Record<string, ToolPermission>) => {
    const previous = client.getQueryData<ToolPermissionsData>(TOOL_PERMISSIONS_KEY);
    client.setQueryData<ToolPermissionsData>(TOOL_PERMISSIONS_KEY, { permissions });
    try {
      client.setQueryData(TOOL_PERMISSIONS_KEY, await botsApi.setToolPermissions(permissions));
    } catch (error) {
      client.setQueryData(TOOL_PERMISSIONS_KEY, previous);
      throw error;
    }
  };
}
