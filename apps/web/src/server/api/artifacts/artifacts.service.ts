import { createHash } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import type {
  ArtifactCommit,
  ArtifactKind,
  ArtifactRef,
  ArtifactSnapshot,
} from "@tiny-agents/agent";
import { artifacts, artifactVersions, db } from "../../db";
import type {
  ArtifactDetail,
  ArtifactVersion,
  ArtifactVersionOp,
} from "../../../shared/api/artifacts";

type ArtifactRow = typeof artifacts.$inferSelect;
type VersionRow = typeof artifactVersions.$inferSelect;

export interface NewArtifact {
  botId: string;
  conversationId: string;
  sourceKey: string;
  slug: string;
  title: string;
  kind: ArtifactKind;
  language?: string;
  content: string;
}

export interface ArtifactChange {
  conversationId: string;
  sourceKey: string;
  slug: string;
  baseSeq: number;
  op: Exclude<ArtifactVersionOp, "create">;
  title?: string;
  content: string;
  author?: "bot" | "owner";
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

function refOf(row: ArtifactRow, seq = row.headSeq): ArtifactRef {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    kind: row.kind,
    language: row.language,
    seq,
  };
}

function versionBySource(sourceKey: string) {
  return db
    .select({ artifact: artifacts, seq: artifactVersions.seq })
    .from(artifactVersions)
    .innerJoin(artifacts, eq(artifacts.id, artifactVersions.artifactId))
    .where(eq(artifactVersions.sourceKey, sourceKey))
    .get();
}

function inConversation(conversationId: string, slug: string) {
  return and(eq(artifacts.conversationId, conversationId), eq(artifacts.slug, slug));
}

export function createArtifact(input: NewArtifact): ArtifactRef {
  return db.transaction((tx) => {
    const replayed = versionBySource(input.sourceKey);
    if (replayed) return refOf(replayed.artifact, replayed.seq);
    const existing = tx
      .select()
      .from(artifacts)
      .where(inConversation(input.conversationId, input.slug))
      .get();
    if (existing) {
      throw new Error(
        `This chat already has an artifact "${input.slug}" at version ${existing.headSeq}. Change it with edit_artifact or rewrite_artifact, or pick another slug.`,
      );
    }
    const row = tx
      .insert(artifacts)
      .values({
        botId: input.botId,
        conversationId: input.conversationId,
        slug: input.slug,
        title: input.title,
        kind: input.kind,
        language: input.kind === "code" ? (input.language ?? null) : null,
        headSeq: 1,
      })
      .returning()
      .get();
    tx.insert(artifactVersions)
      .values({
        artifactId: row.id,
        seq: 1,
        op: "create",
        title: input.title,
        content: input.content,
        contentSha256: sha256(input.content),
        sourceKey: input.sourceKey,
      })
      .run();
    return refOf(row);
  });
}

export function commitArtifact(change: ArtifactChange): ArtifactCommit | undefined {
  return db.transaction((tx) => {
    const replayed = versionBySource(change.sourceKey);
    if (replayed) return { artifact: refOf(replayed.artifact, replayed.seq) };
    const row = tx
      .select()
      .from(artifacts)
      .where(inConversation(change.conversationId, change.slug))
      .get();
    if (!row) return undefined;
    return appendVersion(tx, row, change);
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function appendVersion(
  tx: Tx,
  row: ArtifactRow,
  change: Omit<ArtifactChange, "conversationId" | "slug">,
): ArtifactCommit {
  if (row.headSeq !== change.baseSeq) return { stale: refOf(row) };
  const seq = row.headSeq + 1;
  const title = change.title ?? row.title;
  tx.insert(artifactVersions)
    .values({
      artifactId: row.id,
      seq,
      op: change.op,
      title,
      content: change.content,
      contentSha256: sha256(change.content),
      sourceKey: change.sourceKey,
      author: change.author ?? "bot",
    })
    .run();
  const updated = tx
    .update(artifacts)
    .set({ headSeq: seq, title, updatedAt: new Date() })
    .where(and(eq(artifacts.id, row.id), eq(artifacts.headSeq, row.headSeq)))
    .returning()
    .get();
  if (!updated) throw new Error(`Artifact "${row.slug}" changed while saving; try again.`);
  return { artifact: refOf(updated) };
}

function versionRow(artifactId: string, seq: number): VersionRow | undefined {
  return db
    .select()
    .from(artifactVersions)
    .where(and(eq(artifactVersions.artifactId, artifactId), eq(artifactVersions.seq, seq)))
    .get();
}

export function readArtifact(
  conversationId: string,
  slug: string,
  seq?: number,
): ArtifactSnapshot | undefined {
  const row = db.select().from(artifacts).where(inConversation(conversationId, slug)).get();
  if (!row) return undefined;
  const version = versionRow(row.id, seq ?? row.headSeq);
  if (!version) return undefined;
  return { ...refOf(row, version.seq), title: version.title, content: version.content };
}

export function listArtifacts(conversationId: string): ArtifactRef[] {
  return db
    .select()
    .from(artifacts)
    .where(eq(artifacts.conversationId, conversationId))
    .orderBy(asc(artifacts.createdAt))
    .all()
    .map((row) => refOf(row));
}

function ownedRow(botId: string, artifactId: string): ArtifactRow {
  const row = db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.id, artifactId), eq(artifacts.botId, botId)))
    .get();
  if (!row) throw Boom.notFound("Artifact not found");
  return row;
}

export function artifactDetail(botId: string, artifactId: string): ArtifactDetail {
  const row = ownedRow(botId, artifactId);
  const versions = db
    .select({
      seq: artifactVersions.seq,
      op: artifactVersions.op,
      title: artifactVersions.title,
      author: artifactVersions.author,
      createdAt: artifactVersions.createdAt,
    })
    .from(artifactVersions)
    .where(eq(artifactVersions.artifactId, row.id))
    .orderBy(desc(artifactVersions.seq))
    .all();
  return {
    id: row.id,
    botId: row.botId,
    slug: row.slug,
    title: row.title,
    kind: row.kind,
    language: row.language,
    headSeq: row.headSeq,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    versions: versions.map((v) => ({ ...v, createdAt: v.createdAt.toISOString() })),
  };
}

export function artifactVersion(botId: string, artifactId: string, seq: number): ArtifactVersion {
  const row = ownedRow(botId, artifactId);
  const version = versionRow(row.id, seq);
  if (!version) throw Boom.notFound("Version not found");
  return {
    seq: version.seq,
    op: version.op,
    title: version.title,
    content: version.content,
    createdAt: version.createdAt.toISOString(),
  };
}

export function restoreArtifact(botId: string, artifactId: string, seq: number): ArtifactDetail {
  db.transaction((tx) => {
    const row = ownedRow(botId, artifactId);
    const version = versionRow(row.id, seq);
    if (!version) throw Boom.notFound("Version not found");
    if (seq === row.headSeq) throw Boom.badRequest("That version is already the latest");
    appendVersion(tx, row, {
      sourceKey: `restore:${row.id}:${row.headSeq}`,
      baseSeq: row.headSeq,
      op: "restore",
      title: version.title,
      content: version.content,
      author: "owner",
    });
  });
  return artifactDetail(botId, artifactId);
}
