/**
 * Line comments on a thread's diff, kept until they reach its agent (the
 * Changes and Review panels, any harness). They go as one message, each with
 * its file, lines and the quoted lines: on their own (`/review/send`) or
 * ahead of the owner's next message (`/messages` with `withReview`), after a
 * `---` line like the one between comments, so the transcript can show each
 * comment as a card (`parseReviewMessage` on the client) and the message after.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { codeReviewDrafts, db } from "../../db";
import type { ReviewDraft } from "../../../shared/api/code";

export const draftView = (row: typeof codeReviewDrafts.$inferSelect): ReviewDraft => ({
  id: row.id,
  path: row.path,
  side: row.side,
  startLine: row.startLine,
  endLine: row.endLine,
  quote: row.quote,
  body: row.body,
  createdAt: row.createdAt.toISOString(),
});

export const unsentDrafts = (threadId: string) =>
  and(eq(codeReviewDrafts.threadId, threadId), isNull(codeReviewDrafts.sentAt));

/** The drafts as one message: file, lines and the quoted lines travel with each comment. */
export function reviewMessage(drafts: ReviewDraft[]): string {
  const parts = drafts.map((d) => {
    const lines = d.startLine === d.endLine ? `${d.startLine}` : `${d.startLine}-${d.endLine}`;
    const quote = d.quote ? `\n\`\`\`\n${d.quote.replace(/```/g, "ʼʼʼ")}\n\`\`\`` : "";
    return `**\`${d.path}:${lines}\`**${d.side === "old" ? " (old side)" : ""}${quote}\n${d.body}`;
  });
  return `Review comments (${drafts.length}):\n\n${parts.join("\n\n---\n\n")}`;
}

/**
 * The thread's unsent comments, oldest first, with `sent()` to mark exactly
 * these once the harness took them (a comment saved meanwhile waits for the next).
 */
export async function pendingReview(
  threadId: string,
): Promise<{ drafts: ReviewDraft[]; sent(): Promise<void> }> {
  const rows = await db.select().from(codeReviewDrafts).where(unsentDrafts(threadId));
  const drafts = rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map(draftView);
  return {
    drafts,
    async sent() {
      if (drafts.length === 0) return;
      await db
        .update(codeReviewDrafts)
        .set({ sentAt: new Date() })
        .where(
          and(
            unsentDrafts(threadId),
            inArray(
              codeReviewDrafts.id,
              drafts.map((d) => d.id),
            ),
          ),
        );
    },
  };
}
