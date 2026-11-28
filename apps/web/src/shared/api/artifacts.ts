import type { ArtifactKind } from "@tiny-agents/agent";

export type { ArtifactKind };

export type ArtifactVersionOp = "create" | "edit" | "rewrite" | "restore";

interface ArtifactVersionSummary {
  seq: number;
  op: ArtifactVersionOp;
  title: string;
  author: "bot" | "owner";
  createdAt: string;
}

export interface ArtifactDetail {
  id: string;
  botId: string;
  slug: string;
  title: string;
  kind: ArtifactKind;
  language: string | null;
  headSeq: number;
  createdAt: string;
  updatedAt: string;
  versions: ArtifactVersionSummary[];
}

export interface ArtifactVersion {
  seq: number;
  op: ArtifactVersionOp;
  title: string;
  content: string;
  createdAt: string;
}

export interface ArtifactRestoreBody {
  seq: number;
}
