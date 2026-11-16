/**
 * The GitHub App's webhook (issue #297 §7.4, phase 6): public, so GitHub can
 * reach it, and refused unless signed with the App's webhook secret. A
 * delivery is only a hint to look now: its id is stored (unique, so a
 * redelivery is dropped), the linked PRs it names have their reconcile
 * brought forward, and the reconciler reads a fresh snapshot as always.
 * Nothing in the payload is acted on. The delayed reconcile chain stays the
 * backup for deliveries that never arrive.
 */
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import type { AppEnv } from "@groot/core/types";
import { Boom } from "@groot/core/errors";
import { ok } from "@groot/core/utils/api-response.utils";
import { routeBodyLimit } from "@groot/core/middlewares/body-limit.middleware";
import { verifyWebhook } from "@tiny-agents/github";
import { codePrEvents, codeProjects, codePullRequests, db, type CodePullRow } from "../../db";
import { webhookSecret } from "./code.github";
import { armReconcile } from "./code.pulls";

/** How soon a hinted PR is looked at (a burst of deliveries becomes one look). */
const HINT_DELAY_MS = 5_000;

interface Payload {
  repository?: { full_name?: string };
  pull_request?: { number?: number };
  issue?: { number?: number; pull_request?: unknown };
  check_run?: { head_sha?: string; pull_requests?: Array<{ number?: number }> };
  check_suite?: { head_sha?: string; pull_requests?: Array<{ number?: number }> };
  sha?: string;
}

/** The open linked PRs a delivery is about: by number, or by head sha for statuses. */
async function pullsOf(payload: Payload): Promise<CodePullRow[]> {
  const [owner, name] = (payload.repository?.full_name ?? "").split("/");
  if (!owner || !name) return [];
  const project = (await db.select().from(codeProjects)).find(
    (p) =>
      p.repoOwner.toLowerCase() === owner.toLowerCase() &&
      p.repoName.toLowerCase() === name.toLowerCase(),
  );
  if (!project) return [];
  const open = await db
    .select()
    .from(codePullRequests)
    .where(and(eq(codePullRequests.projectId, project.id), eq(codePullRequests.state, "open")));
  const numbers = new Set<number>(
    [
      payload.pull_request?.number,
      payload.issue?.pull_request ? payload.issue.number : undefined,
      ...(payload.check_run?.pull_requests ?? []).map((p) => p.number),
      ...(payload.check_suite?.pull_requests ?? []).map((p) => p.number),
    ].filter((n): n is number => typeof n === "number"),
  );
  const shas = new Set(
    [payload.sha, payload.check_run?.head_sha, payload.check_suite?.head_sha].filter(Boolean),
  );
  return open.filter((p) => numbers.has(p.number) || (p.headSha !== null && shas.has(p.headSha)));
}

const router = new Hono<AppEnv>();

router.post(
  "/code/github/webhook",
  routeBodyLimit(10 * 1024 * 1024, {
    onError: () => {
      throw Boom.entityTooLarge("Webhook payloads are limited to 10 MB");
    },
  }),
  async (c) => {
    const secret = await webhookSecret().catch(() => undefined);
    if (!secret) throw Boom.notFound("No GitHub App is set up.");
    const body = await c.req.text();
    if (!(await verifyWebhook(secret, body, c.req.header("x-hub-signature-256")))) {
      throw Boom.unauthorized("Bad signature");
    }
    const delivery = c.req.header("x-github-delivery");
    const event = c.req.header("x-github-event");
    if (!delivery || !event || delivery.length > 100)
      throw Boom.badRequest("Not a GitHub delivery");
    let payload: Payload;
    try {
      payload = JSON.parse(body) as Payload;
    } catch {
      throw Boom.badRequest("The payload is not JSON");
    }
    const pulls = event === "ping" ? [] : await pullsOf(payload);
    const fresh = await db
      .insert(codePrEvents)
      .values({ deliveryId: delivery, event, pullId: pulls[0]?.id ?? null })
      .onConflictDoNothing()
      .returning({ id: codePrEvents.deliveryId });
    if (fresh.length === 0) return ok(c, { duplicate: true, looked: 0 });
    for (const pull of pulls) await armReconcile(pull.id, HINT_DELAY_MS);
    return ok(c, { duplicate: false, looked: pulls.length });
  },
);

export default router;
