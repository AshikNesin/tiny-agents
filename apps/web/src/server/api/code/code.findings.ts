import { and, asc, eq, isNotNull } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { codeFindings, codeReviews, db, type CodeFindingRow } from "../../db";
import type { FindingView } from "../../../shared/api/code";
import { parseReviewReport, reviewRequest } from "../../../shared/review-report";
import type { CodeHub } from "./code.hub";
import { getProject, withWorkflowInstructions } from "./code.projects";
import { askReview, reviewComments } from "./code.reviews";

const view = (row: CodeFindingRow): FindingView => ({
  id: row.id,
  severity: row.severity,
  title: row.title,
  body: row.body,
  path: row.path,
  line: row.line,
  state: row.state,
});

async function findingsOf(reviewId: string): Promise<FindingView[]> {
  const rows = await db
    .select()
    .from(codeFindings)
    .where(eq(codeFindings.reviewId, reviewId))
    .orderBy(asc(codeFindings.createdAt));
  return rows.map(view);
}

export async function startAgentReview(reviewId: string): Promise<{ threadId: string }> {
  const [review] = await db.select().from(codeReviews).where(eq(codeReviews.id, reviewId));
  if (!review) throw Boom.notFound("No such review");
  if (review.reviewingSince) throw Boom.conflict("The agent is already reviewing this.");
  const project = await getProject(review.projectId);
  const asked = await askReview(
    reviewId,
    withWorkflowInstructions(reviewRequest(review.reviewedSha), project),
  );
  await db
    .update(codeReviews)
    .set({ reviewingSince: new Date() })
    .where(eq(codeReviews.id, reviewId));
  return asked;
}

function lastAnswer(items: Array<{ kind: string; text?: string }>): string {
  const texts: string[] = [];
  for (let at = items.length - 1; at >= 0; at -= 1) {
    const item = items[at]!;
    if (item.kind === "assistant" && item.text) texts.unshift(item.text);
    else if (item.kind === "user") break;
  }
  return texts.join("\n");
}

export async function onReviewTurnEnded(hub: CodeHub, threadId: string): Promise<boolean> {
  const [review] = await db
    .select()
    .from(codeReviews)
    .where(and(eq(codeReviews.threadId, threadId), isNotNull(codeReviews.reviewingSince)));
  const target = hub.resolve(threadId);
  if (!review || !target) return false;
  const snapshot = await target.instance.getThread(target.nativeId);
  const report = parseReviewReport(lastAnswer(snapshot.items));
  db.transaction((tx) => {
    tx.update(codeReviews)
      .set({ reviewingSince: null, ...(report ? { brief: report.brief } : {}) })
      .where(eq(codeReviews.id, review.id))
      .run();
    if (!report) return;
    tx.delete(codeFindings)
      .where(and(eq(codeFindings.reviewId, review.id), eq(codeFindings.state, "open")))
      .run();
    for (const finding of report.findings) {
      tx.insert(codeFindings)
        .values({ reviewId: review.id, headSha: review.headSha, ...finding })
        .run();
    }
  });
  return true;
}

export async function decideFinding(
  reviewId: string,
  findingId: string,
  decision: { action: "add"; body?: string } | { action: "dismiss" },
): Promise<FindingView[]> {
  const open = and(
    eq(codeFindings.id, findingId),
    eq(codeFindings.reviewId, reviewId),
    eq(codeFindings.state, "open"),
  );
  const [finding] = await db.select().from(codeFindings).where(open);
  if (!finding) throw Boom.notFound("That finding is no longer open.");
  if (decision.action === "add") {
    const comments = await reviewComments(reviewId);
    await comments.addDraft({
      path: finding.path,
      startLine: finding.line,
      endLine: finding.line,
      body: decision.body?.trim() || finding.body || finding.title,
    });
  }
  await db
    .update(codeFindings)
    .set({ state: decision.action === "add" ? "added" : "dismissed" })
    .where(open);
  return findingsOf(reviewId);
}
