import { parseJson } from "@tiny-agents/std";
import { routes } from "../routes";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { env } from "@groot/core/env";
import { logger } from "@groot/core/logger";
import { and, eq } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { ok } from "@groot/core/utils/api-response.utils";
import { routeBodyLimit } from "@groot/core/middlewares/body-limit.middleware";
import { verifyWebhook } from "@tiny-agents/github";
import { codePrEvents, codeProjects, codePullRequests, db, type CodePullRow } from "../../db";
import type { AppContext } from "@groot/core/types";
import { completeInstall, completeManifest, FLOW_COOKIE, webhookSecret } from "./code.github";
import { armReconcile } from "./code.pulls";

const HINT_DELAY_MS = 5_000;

const numberedSchema = z.looseObject({ number: z.number().nullish() });

const checkedSchema = z.looseObject({
  head_sha: z.string().nullish(),
  pull_requests: z.array(numberedSchema).nullish(),
});

const payloadSchema = z.looseObject({
  repository: z.looseObject({ full_name: z.string().nullish() }).nullish(),
  pull_request: numberedSchema.nullish(),
  issue: z
    .looseObject({ number: z.number().nullish(), pull_request: z.unknown().optional() })
    .nullish(),
  check_run: checkedSchema.nullish(),
  check_suite: checkedSchema.nullish(),
  sha: z.string().nullish(),
});

type Payload = z.infer<typeof payloadSchema>;

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

const router = routes();

const COOKIE_PATH = "/api/v1/code/github";

export function setFlowCookie(c: AppContext, binding: string): void {
  setCookie(c, FLOW_COOKIE, binding, {
    path: COOKIE_PATH,
    secure: env.ORIGIN.startsWith("https://"),
    httpOnly: true,
    sameSite: "Lax",
    maxAge: 600,
  });
}

const stateSchema = z.string().min(20).max(100);

for (const kind of ["callback", "installed"] as const) {
  router.get(`/code/github/${kind}`, async (c) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    const binding = getCookie(c, FLOW_COOKIE);
    deleteCookie(c, FLOW_COOKIE, { path: COOKIE_PATH });
    try {
      if (!binding) throw Boom.badRequest("This browser did not start the GitHub setup.");
      const state = stateSchema.parse(c.req.query("state"));
      if (kind === "callback") {
        await completeManifest(
          state,
          binding,
          z.string().min(1).max(200).parse(c.req.query("code")),
        );
      } else {
        const id = z.coerce.number().int().positive().parse(c.req.query("installation_id"));
        await completeInstall(state, binding, id);
      }
      return c.redirect(`/code?github=${kind === "callback" ? "created" : "installed"}`);
    } catch (error) {
      logger.warn({ error }, `Code: GitHub App ${kind} failed`);
      return c.redirect("/code?github=error");
    }
  });
}

router.post(
  "/code/github/webhook",
  "public",
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
      payload = parseJson("A GitHub webhook payload", body, payloadSchema);
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

export default router.hono;
