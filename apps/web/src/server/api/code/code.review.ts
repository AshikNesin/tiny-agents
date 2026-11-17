/**
 * A thread's review (the Changes and Review panels, any harness): which
 * files the owner marked viewed, and the line comments kept until they
 * reach its agent. `threadReview(threadId)` is the one way in; routes only
 * parse and delegate.
 *
 * Comments go as one message, each with its file, lines and the quoted
 * lines: on their own (`/review/send`) or ahead of the owner's next message
 * (`/messages` with `withReview`), after a `---` line like the one between
 * comments, so the transcript can show each comment as a card
 * (`parseReviewMessage` on the client) and the message after. `send` marks
 * exactly the comments it sent once the harness took them; one saved
 * meanwhile waits for the next.
 */
import { Boom } from "@groot/core/errors";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { codeReviewDrafts, codeReviewViewed, db } from "../../db";
import type { ReviewDraft } from "../../../shared/api/code";

const draftView = (row: typeof codeReviewDrafts.$inferSelect): ReviewDraft => ({
  id: row.id,
  path: row.path,
  side: row.side,
  startLine: row.startLine,
  endLine: row.endLine,
  quote: row.quote,
  body: row.body,
  createdAt: row.createdAt.toISOString(),
});

/** The drafts as one message: file, lines and the quoted lines travel with each comment. */
function reviewMessage(drafts: ReviewDraft[]): string {
  const parts = drafts.map((d) => {
    const lines = d.startLine === d.endLine ? `${d.startLine}` : `${d.startLine}-${d.endLine}`;
    const quote = d.quote ? `\n\`\`\`\n${d.quote.replace(/```/g, "ʼʼʼ")}\n\`\`\`` : "";
    return `**\`${d.path}:${lines}\`**${d.side === "old" ? " (old side)" : ""}${quote}\n${d.body}`;
  });
  return `Review comments (${drafts.length}):\n\n${parts.join("\n\n---\n\n")}`;
}

interface DraftInput {
  path: string;
  side?: "old" | "new";
  startLine: number;
  endLine: number;
  quote?: string;
  body: string;
}

export interface ThreadReview {
  /** Each file with whether the owner marked its current content viewed. */
  withViewed<F extends { path: string; hash: string }>(
    files: F[],
  ): Promise<Array<F & { viewed: boolean }>>;
  markViewed(path: string, hash: string, viewed: boolean): Promise<void>;
  /** Unsent comments, oldest first. */
  drafts(): Promise<ReviewDraft[]>;
  /** Throws 400 for a range that ends before it starts. */
  addDraft(input: DraftInput): Promise<ReviewDraft>;
  removeDraft(id: string): Promise<void>;
  /**
   * Hand the unsent comments, as one message (null when there are none) and
   * as they are, to `deliver`; once it resolves, exactly those are marked sent.
   */
  send<R>(
    deliver: (review: string | null, drafts: ReviewDraft[]) => Promise<R>,
  ): Promise<{ result: R; sent: number }>;
}

/**
 * `target` picks which comments: the agent's (the default), or a PR review's
 * pending GitHub comments (`github`, issue #345), kept apart under the same key.
 */
export function threadReview(threadId: string, target: "agent" | "github" = "agent"): ThreadReview {
  const unsent = and(
    eq(codeReviewDrafts.threadId, threadId),
    eq(codeReviewDrafts.target, target),
    isNull(codeReviewDrafts.sentAt),
  );
  const ofThread = eq(codeReviewViewed.threadId, threadId);

  async function drafts(): Promise<ReviewDraft[]> {
    const rows = await db
      .select()
      .from(codeReviewDrafts)
      .where(unsent)
      .orderBy(asc(codeReviewDrafts.createdAt));
    return rows.map(draftView);
  }

  return {
    async withViewed(files) {
      const viewed = await db.select().from(codeReviewViewed).where(ofThread);
      const marks = new Map(viewed.map((v) => [v.path, v.contentHash]));
      return files.map((f) => ({ ...f, viewed: marks.get(f.path) === f.hash }));
    },

    async markViewed(path, hash, viewed) {
      if (viewed) {
        await db
          .insert(codeReviewViewed)
          .values({ threadId, path, contentHash: hash })
          .onConflictDoUpdate({
            target: [codeReviewViewed.threadId, codeReviewViewed.path],
            set: { contentHash: hash },
          });
      } else {
        await db.delete(codeReviewViewed).where(and(ofThread, eq(codeReviewViewed.path, path)));
      }
    },

    drafts,

    async addDraft(input) {
      if (input.endLine < input.startLine)
        throw Boom.badRequest("The range ends before it starts.");
      const [row] = await db
        .insert(codeReviewDrafts)
        .values({
          threadId,
          ...input,
          side: input.side ?? "new",
          quote: input.quote ?? "",
          target,
        })
        .returning();
      return draftView(row!);
    },

    async removeDraft(id) {
      await db.delete(codeReviewDrafts).where(and(unsent, eq(codeReviewDrafts.id, id)));
    },

    async send(deliver) {
      const pending = await drafts();
      const result = await deliver(pending.length > 0 ? reviewMessage(pending) : null, pending);
      if (pending.length > 0) {
        await db
          .update(codeReviewDrafts)
          .set({ sentAt: new Date() })
          .where(
            and(
              unsent,
              inArray(
                codeReviewDrafts.id,
                pending.map((d) => d.id),
              ),
            ),
          );
      }
      return { result, sent: pending.length };
    },
  };
}
