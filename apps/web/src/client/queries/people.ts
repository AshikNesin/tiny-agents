import { useMutation } from "@tanstack/react-query";
import type { GuestCreateBody } from "../../shared/api/people";
import { peopleApi } from "../lib/people-api";
import { RESOURCE_MUTATION, useResource } from "./resource";

export const useGuests = (options: { enabled?: boolean } = {}) =>
  useResource(
    ["people", "guests"],
    async () => (await peopleApi.list()).guests,
    "Failed to load guests",
    options,
  );

export function useGuestMutations() {
  const add = useMutation({
    mutationFn: (input: GuestCreateBody) => peopleApi.add(input),
    ...RESOURCE_MUTATION,
  });
  const remove = useMutation({
    mutationFn: (id: number) => peopleApi.remove(id),
    ...RESOURCE_MUTATION,
  });
  return { add, remove };
}
