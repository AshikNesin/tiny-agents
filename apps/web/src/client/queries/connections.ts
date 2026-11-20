import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  Connection,
  ConnectionCreateBody,
  ConnectionTestBody,
  ConnectionToolDetail,
  ConnectionToolUpdateBody,
  ConnectionUpdateBody,
} from "../../shared/api/connections";
import { connectionsApi } from "../lib/connections-api";
import { RESOURCE_MUTATION, useResource, useSecretMutation } from "./resource";

const connectionKey = (id: string) => ["connections", "detail", id] as const;
const toolKey = (id: string, tool: string) => ["connections", "tool", id, tool] as const;

export const useConnections = () =>
  useResource(["connections", "list"], () => connectionsApi.list(), "Failed to load connections");

export const useConnection = (id: string) =>
  useResource(connectionKey(id), () => connectionsApi.get(id), "Failed to load connection");

export function useSetConnection(id: string) {
  const client = useQueryClient();
  return (connection: Connection) => client.setQueryData<Connection>(connectionKey(id), connection);
}

export const useConnectionTool = (id: string, tool: string) =>
  useResource(toolKey(id, tool), () => connectionsApi.getTool(id, tool), "Failed to load tool");

export function useSetConnectionTool(id: string, tool: string) {
  const client = useQueryClient();
  return (detail: ConnectionToolDetail) =>
    client.setQueryData<ConnectionToolDetail>(toolKey(id, tool), detail);
}

export function useConnectionMutations() {
  const create = useSecretMutation((input: ConnectionCreateBody) => connectionsApi.create(input));
  const update = useSecretMutation(({ id, input }: { id: string; input: ConnectionUpdateBody }) =>
    connectionsApi.update(id, input),
  );
  const test = useSecretMutation((input: ConnectionTestBody) => connectionsApi.test(input));
  const remove = useMutation({
    mutationFn: (id: string) => connectionsApi.remove(id),
    ...RESOURCE_MUTATION,
  });
  const reconnect = useMutation({
    mutationFn: (id: string) => connectionsApi.reconnect(id),
    ...RESOURCE_MUTATION,
  });
  const updateTool = useMutation({
    mutationFn: (vars: { id: string; tool: string; input: ConnectionToolUpdateBody }) =>
      connectionsApi.updateTool(vars.id, vars.tool, vars.input),
    ...RESOURCE_MUTATION,
  });
  const callTool = useMutation({
    mutationFn: (vars: { id: string; tool: string; args: Record<string, unknown> }) =>
      connectionsApi.callTool(vars.id, vars.tool, vars.args),
    ...RESOURCE_MUTATION,
  });
  return { create, update, test, remove, reconnect, updateTool, callTool };
}
