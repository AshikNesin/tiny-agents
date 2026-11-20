import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  Account,
  AccountConnectionBody,
  AccountCreateBody,
  AccountPatchBody,
  ModelAddBody,
  ModelEndpoint,
  ModelPatchBody,
  ModelTestBody,
  RolesBody,
} from "../../shared/api/models";
import { errorMessage } from "../lib/errors";
import { modelsApi } from "../lib/models-api";
import { RESOURCE_MUTATION, useResource, useSecretMutation } from "./resource";

export const useModelSettings = (loadModels: () => Promise<unknown>) =>
  useResource(
    ["models", "settings"],
    async () => {
      try {
        const [{ accounts, templates }, { roles }] = await Promise.all([
          modelsApi.accounts(),
          modelsApi.roles(),
        ]);
        return { accounts, templates, roles };
      } catch (error) {
        toast.error(errorMessage(error, "Couldn't load models"));
        throw error;
      } finally {
        void loadModels();
      }
    },
    "Couldn't load models",
  );

export function useModelMutations() {
  const create = useSecretMutation((input: AccountCreateBody) => modelsApi.create(input));
  const updateConnection = useSecretMutation((vars: { id: string; input: AccountConnectionBody }) =>
    modelsApi.updateConnection(vars.id, vars.input),
  );
  const patch = useMutation({
    mutationFn: (vars: { account: Account; input: AccountPatchBody }) =>
      modelsApi.patch(vars.account, vars.input),
    ...RESOURCE_MUTATION,
  });
  const remove = useMutation({
    mutationFn: (vars: { id: string; moveTo: string | undefined }) =>
      modelsApi.remove(vars.id, vars.moveTo),
    ...RESOURCE_MUTATION,
  });
  const addModel = useMutation({
    mutationFn: (vars: { accountId: string; input: ModelAddBody }) =>
      modelsApi.addModel(vars.accountId, vars.input),
    ...RESOURCE_MUTATION,
  });
  const patchModel = useMutation({
    mutationFn: (vars: { id: string; input: ModelPatchBody }) =>
      modelsApi.patchModel(vars.id, vars.input),
    ...RESOURCE_MUTATION,
  });
  const removeModel = useMutation({
    mutationFn: (vars: { id: string; moveTo: string | undefined }) =>
      modelsApi.removeModel(vars.id, vars.moveTo),
    ...RESOURCE_MUTATION,
  });
  const setRoles = useMutation({
    mutationFn: (input: RolesBody) => modelsApi.setRoles(input),
    ...RESOURCE_MUTATION,
  });
  return { create, updateConnection, patch, remove, addModel, patchModel, removeModel, setRoles };
}

export function useModelDiscovery() {
  const discover = useSecretMutation((connection: ModelEndpoint) => modelsApi.discover(connection));
  const test = useSecretMutation((input: ModelTestBody) => modelsApi.test(input));
  const available = useMutation({
    mutationFn: (accountId: string) => modelsApi.available(accountId),
    ...RESOURCE_MUTATION,
  });
  const refresh = useMutation({
    mutationFn: (accountId: string) => modelsApi.refresh(accountId),
    ...RESOURCE_MUTATION,
  });
  return { discover, test, available, refresh };
}
