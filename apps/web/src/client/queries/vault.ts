/**
 * The Vault pages' resources: the overview, one item, a bot's credential
 * request, and their writes (`lib/vault-api.ts`). The step-up token stays in
 * `vault-api.ts`'s memory and the step-up prompt (`components/vault/StepUp`)
 * asks for it outside React Query: a password never sits in a cache.
 */
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

/**
 * The backends, items and unlinked items. `reload(true)` asks the server to
 * read the backends again (the Refresh button); every other fetch reads what
 * it already has.
 */
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

/**
 * One item with its activity. Every fetch lands as a new object, even when
 * nothing changed, so the page resets its policy form to each one.
 */
export const useVaultItem = (handle: string) =>
  useResource(["vault", "item", handle], () => vaultApi.detail(handle), "Failed to load the item", {
    structuralSharing: false,
  });

/**
 * A bot's credential request. Another task id keeps showing the request on
 * screen until the next one lands.
 */
export const useCredentialRequest = (taskId: number) =>
  useResource(
    ["vault", "request", taskId],
    () => vaultApi.request(taskId),
    "This request is no longer open",
    { placeholderData: keepPreviousData },
  );

/**
 * The vault writes; each needs step-up but the request ones, and the caller
 * runs it through `useStepUp().run`. None refetches: each page does where it
 * always did. What carries a value (a new item, a changed value, a filled
 * request) keeps nothing once answered.
 */
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

/**
 * Reveal or copy one value (step-up, through `useStepUp().run`). Nothing is
 * kept: the caller holds the value in the field that shows it, and only
 * there.
 */
export const useVaultReveal = () =>
  useSecretMutation((vars: { handle: string; field: ValueField; purpose: "reveal" | "copy" }) =>
    vaultApi.reveal(vars.handle, vars.field, vars.purpose),
  );
