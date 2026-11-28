import { useMutation } from "@tanstack/react-query";
import { pushApi } from "../lib/push-api";
import { RESOURCE_MUTATION, useResource } from "./resource";

export const usePushDevices = () =>
  useResource(
    ["push", "devices"],
    async () => (await pushApi.devices()).devices,
    "Failed to load phones",
  );

export function usePushDeviceMutations() {
  const test = useMutation({
    mutationFn: (id: string) => pushApi.test(id),
    ...RESOURCE_MUTATION,
  });
  const remove = useMutation({
    mutationFn: (id: string) => pushApi.remove(id),
    ...RESOURCE_MUTATION,
  });
  return { test, remove };
}
