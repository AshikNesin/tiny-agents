import { useMutation } from "@tanstack/react-query";
import { artifactsApi } from "../lib/artifacts-api";
import { RESOURCE_MUTATION, useResource } from "./resource";

export const useArtifact = (botId: string, artifactId: string) =>
  useResource(
    ["artifacts", botId, artifactId],
    () => artifactsApi.get(botId, artifactId),
    "Failed to load the artifact",
  );

export const useArtifactVersion = (botId: string, artifactId: string, seq: number) =>
  useResource(
    ["artifacts", botId, artifactId, "version", seq],
    () => artifactsApi.version(botId, artifactId, seq),
    "Failed to load this version",
    { staleTime: Infinity, gcTime: 5 * 60_000 },
  );

export function useRestoreArtifact(botId: string, artifactId: string) {
  return useMutation({
    mutationFn: (seq: number) => artifactsApi.restore(botId, artifactId, { seq }),
    ...RESOURCE_MUTATION,
  });
}
