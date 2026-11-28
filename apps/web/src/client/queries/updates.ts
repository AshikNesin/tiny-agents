import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { UpdateView } from "../../shared/local-updates";
import { updatesApi } from "../lib/updates-api";
import { RESOURCE_MUTATION, useResource } from "./resource";

const UPDATES_KEY = ["system", "update"] as const;
const POLL_MS = 2000;

export const useUpdateView = (busy: (view: UpdateView | undefined) => boolean) =>
  useResource(UPDATES_KEY, () => updatesApi.get(), "Could not load updates", {
    refetchInterval: (query) => (busy(query.state.data) ? POLL_MS : false),
  });

export function useUpdateMutations() {
  const client = useQueryClient();
  const show = (view: UpdateView) => client.setQueryData<UpdateView>(UPDATES_KEY, view);
  const check = useMutation({
    mutationFn: async () => show(await updatesApi.check()),
    ...RESOURCE_MUTATION,
  });
  const apply = useMutation({
    mutationFn: async () => show(await updatesApi.apply()),
    ...RESOURCE_MUTATION,
  });
  return { check, apply };
}
