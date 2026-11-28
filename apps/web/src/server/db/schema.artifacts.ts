import { relations } from "drizzle-orm";
import { index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import type { ArtifactKind, ArtifactVersionOp } from "../../shared/api/artifacts";
import { createdAt, id, ms } from "./schema.columns";
import { bots } from "./schema";

export const artifacts = sqliteTable(
  "artifacts",
  {
    id: id(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    kind: text("kind").$type<ArtifactKind>().notNull(),
    language: text("language"),
    headSeq: integer("head_seq").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: ms("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    unique("artifacts_conversation_slug_unique").on(t.conversationId, t.slug),
    index("artifacts_bot_id_idx").on(t.botId),
  ],
);

export const artifactVersions = sqliteTable(
  "artifact_versions",
  {
    id: id(),
    artifactId: text("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    op: text("op").$type<ArtifactVersionOp>().notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    contentSha256: text("content_sha256").notNull(),
    sourceKey: text("source_key").unique(),
    author: text("author").$type<"bot" | "owner">().notNull().default("bot"),
    createdAt: createdAt(),
  },
  (t) => [unique("artifact_versions_artifact_seq_unique").on(t.artifactId, t.seq)],
);

export const artifactsRelations = relations(artifacts, ({ many }) => ({
  versions: many(artifactVersions),
}));

export const artifactVersionsRelations = relations(artifactVersions, ({ one }) => ({
  artifact: one(artifacts, { fields: [artifactVersions.artifactId], references: [artifacts.id] }),
}));
