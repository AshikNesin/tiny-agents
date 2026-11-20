import { useRef } from "react";
import { keepPreviousData, useMutation } from "@tanstack/react-query";
import type {
  ValueField,
  VaultItemCreateBody,
  VaultItemUpdateBody,
  VaultLinkBody,
} from "../../shared/api/vault";
import { vaultApi } from "../lib/vault-api";
import { RESOURCE_MUTATION, useResource, useSecretMutation } from "./resource";

export function useVaultOverview() {
  const force = useRef(false);
  const resource = useResource(
    ["vault", "overview"],
    () => {
      const refresh = force.current;
      force.current = false;
      return vaultApi.overview(refresh);
    },
    "Failed to load the vault",
  );
  const reload = async (refresh = false) => {
    force.current = refresh;
    await resource.refresh();
  };
  return { ...resource, reload };
}

export const useVaultItem = (handle: string) =>
  useResource(["vault", "item", handle], () => vaultApi.detail(handle), "Failed to load the item", {
    structuralSharing: false,
  });

export const useCredentialRequest = (taskId: number) =>
  useResource(
    ["vault", "request", taskId],
    () => vaultApi.request(taskId),
    "This request is no longer open",
    { placeholderData: keepPreviousData },
  );

export function useVaultMutations() {
  const create = useSecretMutation((input: VaultItemCreateBody) => vaultApi.create(input));
  const update = useSecretMutation((vars: { handle: string; input: VaultItemUpdateBody }) =>
    vaultApi.update(vars.handle, vars.input),
  );
  const submitRequest = useSecretMutation(
    (vars: { taskId: number; values: Record<string, string>; save: boolean }) =>
      vaultApi.submitRequest(vars.taskId, vars.values, vars.save),
  );
  const link = useMutation({
    mutationFn: (input: VaultLinkBody) => vaultApi.link(input),
    ...RESOURCE_MUTATION,
  });
  const remove = useMutation({
    mutationFn: (vars: { handle: string; purge: boolean }) =>
      vaultApi.remove(vars.handle, vars.purge),
    ...RESOURCE_MUTATION,
  });
  const cancelRequest = useMutation({
    mutationFn: (taskId: number) => vaultApi.cancelRequest(taskId),
    ...RESOURCE_MUTATION,
  });
  return { create, update, submitRequest, link, remove, cancelRequest };
}

export const useVaultReveal = () =>
  useSecretMutation((vars: { handle: string; field: ValueField; purpose: "reveal" | "copy" }) =>
    vaultApi.reveal(vars.handle, vars.field, vars.purpose),
  );
