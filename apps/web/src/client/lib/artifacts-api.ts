import { apiClient } from "@groot/shell/lib/api";
import type {
  ArtifactDetail,
  ArtifactRestoreBody,
  ArtifactVersion,
} from "../../shared/api/artifacts";

const base = (botId: string, artifactId: string) =>
  `/bots/${encodeURIComponent(botId)}/artifacts/${encodeURIComponent(artifactId)}`;

export const ARTIFACT_FRAME_URL = "/api/v1/artifact-frame";

export const artifactsApi = {
  get: (botId: string, artifactId: string) =>
    apiClient.get<ArtifactDetail>(base(botId, artifactId)),
  version: (botId: string, artifactId: string, seq: number) =>
    apiClient.get<ArtifactVersion>(`${base(botId, artifactId)}/versions/${seq}`),
  restore: (botId: string, artifactId: string, body: ArtifactRestoreBody) =>
    apiClient.post<ArtifactDetail>(`${base(botId, artifactId)}/restore`, body),
};
