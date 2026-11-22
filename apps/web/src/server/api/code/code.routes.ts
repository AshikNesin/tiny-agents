import { Hono } from "hono";
import { z } from "zod";
import type { AppContext, AppEnv } from "@groot/core/types";
import { Boom, HttpError } from "@groot/core/errors";
import { logger } from "@groot/core/logger";
import { ok } from "@groot/core/utils/api-response.utils";
import { parseBody } from "@groot/core/utils/controller.utils";
import { routeBodyLimit } from "@groot/core/middlewares/body-limit.middleware";
import {
  HarnessError,
  capabilityMissing,
  type HarnessInstance,
  type ThreadSummary,
} from "@tiny-agents/code/server";
import { eq } from "drizzle-orm";
import { codeThreads, db } from "../../db";
import { openSse } from "../bots/bots.sse";
import { codeHub, type CodeHub } from "./code.hub";
import { follow, markSeen } from "./code.store";
import {
  getProject,
  onProjectThreadDeleted,
  projectThread,
  startProjectThread,
} from "./code.projects";
import { codeChanges } from "./code.changes";
import { codeGitHub } from "./code.github";
import { noteOwnerInput, onThreadArchived } from "./code.pulls";
import { threadReview } from "./code.review";
import { startRun, stopRun } from "./code.runs";
import { decorateThreads, setAttention, threadKey, withThreadKeys } from "./code.threads";

const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

const router = new Hono<AppEnv>();

function toHttp(error: unknown): never {
  if (error instanceof HarnessError) {
    throw new HttpError(error.status, error.message, undefined, error.code?.toUpperCase());
  }
  throw error;
}

async function run<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    return toHttp(error);
  }
}

function hub(): CodeHub {
  const current = codeHub();
  if (!current) throw Boom.unavailable("Code is not set up yet.");
  return current;
}

function harness(c: AppContext): HarnessInstance {
  const instance = hub().instance(c.req.param("instance") ?? "");
  if (!instance) throw Boom.notFound("No such harness");
  return instance;
}

function thread(c: AppContext): { instance: HarnessInstance; nativeId: string; id: string } {
  const target = hub().resolve(decodeURIComponent(c.req.param("id") ?? ""));
  if (!target) throw Boom.notFound("No harness serves this thread");
  return { ...target, id: threadKey(target.instance.id, target.nativeId) };
}

function need<K extends keyof HarnessInstance>(
  instance: HarnessInstance,
  method: K,
  what: string,
): NonNullable<HarnessInstance[K]> {
  const fn = instance[method];
  if (typeof fn !== "function") throw toHttp(capabilityMissing(what));
  return (fn as (...args: unknown[]) => unknown).bind(instance) as NonNullable<HarnessInstance[K]>;
}

function query(c: AppContext, name: string, required = true): string | undefined {
  const value = c.req.query(name);
  if (required && !value) throw Boom.badRequest(`${name} is required`);
  if (value && value.length > 4096) throw Boom.badRequest(`${name} is too long`);
  return value || undefined;
}

function passthrough(upstream: Response): Response {
  const headers = new Headers();
  for (const name of ["content-type", "content-length", "last-modified", "etag"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("cache-control", "private, max-age=300");
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-security-policy", "sandbox; default-src 'none'; img-src 'self' data:");
  return new Response(upstream.body, { status: 200, headers });
}

function describe(instance: HarnessInstance) {
  return {
    id: instance.id,
    kind: instance.kind,
    label: instance.label,
    status: instance.status(),
    capabilities: instance.capabilities(),
    commands: instance.commands?.() ?? [],
  };
}

router.get("/code/status", (c) => {
  const current = codeHub();
  return ok(c, { harnesses: current ? current.instances().map(describe) : [] });
});

router.get("/code/events", (c) => {
  const h = hub();
  return openSse(c, async (sse) => {
    const sendList = async () => sse.write({ type: "list", threads: await h.list() });
    sse.onClose(
      h.onChange((change) => {
        if (change === "status") sse.write({ type: "status", instances: h.statuses() });
        else void sendList();
      }),
    );
    sse.write({ type: "status", instances: h.statuses() });
    await sendList();
  });
});

function unreadable(instance: HarnessInstance) {
  return (error: unknown): ThreadSummary[] => {
    logger.warn({ error, instance: instance.id }, "Could not read a harness's archived threads");
    return [];
  };
}

router.get("/code/threads", async (c) => {
  const h = hub();
  if (c.req.query("view") !== "archived") return ok(c, await h.list());
  const lists = await Promise.all(
    h
      .instances()
      .filter((instance) => instance.capabilities().threads.archive)
      .map((instance) => instance.listThreads("archived").catch(unreadable(instance))),
  );
  return ok(c, await decorateThreads(lists.flat()));
});

const message = z.string().trim().min(1).max(100_000);
const refs = z.array(z.string().max(2048)).max(20).optional();
const permissionMode = z.enum(["default", "acceptEdits", "plan", "bypassPermissions"]);

const createSchema = z.object({
  instanceId: z.string().min(1).max(40).optional(),
  projectId: z.string().min(1).max(64),
  branch: z.string().trim().min(1).max(250).optional(),
  message,
  model: z.string().trim().max(200).optional(),
  effort: z.string().trim().max(20).optional(),
  permissionMode: permissionMode.optional(),
  attachments: refs,
});

router.post("/code/threads", async (c) => {
  const body = await parseBody(c, createSchema);
  const project = await getProject(body.projectId);
  const instanceId = body.instanceId ?? project.defaultInstanceId ?? undefined;
  if (!instanceId) throw Boom.badRequest("Pick an agent.");
  const instance = hub().instance(instanceId);
  if (!instance) throw Boom.notFound("No such agent");
  if (
    body.permissionMode &&
    !instance.capabilities().settings.permissionModes.includes(body.permissionMode)
  ) {
    throw Boom.badRequest("This agent does not offer that permission mode.");
  }
  const { instanceId: _instance, projectId: _project, ...input } = body;
  const started = await run(() => startProjectThread(project, instance, input));
  await startRun(started.threadId, { trigger: "owner" });
  void hub().refresh(instance.id);
  return ok(c, { threadId: started.threadId }, 201);
});

router.get("/code/threads/:id", async (c) => {
  const { instance, nativeId } = thread(c);
  return ok(c, withThreadKeys(await run(() => instance.getThread(nativeId))));
});

router.get("/code/threads/:id/events", (c) => {
  const { id } = thread(c);
  const h = hub();
  return openSse(c, (sse) => {
    sse.onClose(h.watch(id, (event) => sse.write(event)));
  });
});

router.get("/code/threads/:id/changes", async (c) => {
  const { id } = thread(c);
  const project = await projectThread(id);
  const worktree = project?.thread.worktree;
  const ws = worktree ? await codeGitHub().workspace(project.project) : undefined;
  return openSse(c, (sse) => {
    if (!ws || !worktree) {
      sse.write({ type: "unavailable", message: "This thread's changes cannot be watched." });
      return;
    }
    sse.onClose(
      codeChanges().watch(
        `sandbox:${worktree}`,
        () => ws.changeStamp(worktree),
        (event) => sse.write(event),
      ),
    );
  });
});

router.post("/code/threads/:id/seen", async (c) => {
  const { id } = thread(c);
  const { cursor } = await parseBody(c, z.object({ cursor: z.number().int().min(0) }));
  await markSeen(id, cursor);
  hub().listChanged();
  return ok(c, { seen: cursor });
});

const sendSchema = z.object({
  message,
  attachments: refs,
  queue: z.boolean().optional(),
  skills: z.array(z.string().max(200)).max(20).optional(),
  withReview: z.boolean().optional(),
});

router.post("/code/threads/:id/messages", async (c) => {
  const { instance, nativeId, id } = thread(c);
  const { withReview, ...body } = await parseBody(c, sendSchema);
  const submit = (review: string | null) =>
    run(() =>
      instance.send(nativeId, {
        ...body,
        message: review ? `${review}\n\n---\n\n${body.message}` : body.message,
      }),
    );
  const result = withReview ? (await threadReview(id).send(submit)).result : await submit(null);
  const followed = await follow(instance.id, nativeId);
  await startRun(followed, { trigger: "owner" });
  await setAttention(followed, null);
  await noteOwnerInput(followed);
  hub().listChanged();
  return ok(c, result);
});

router.post("/code/threads/:id/interrupt", async (c) => {
  const { instance, nativeId, id } = thread(c);
  await stopRun(id);
  await run(() => instance.interrupt(nativeId));
  return ok(c, { stopped: true });
});

const answerSchema = z.union([
  z.object({
    decision: z.enum(["allow", "deny"]),
    message: z.string().max(10_000).optional(),
  }),
  z.object({ answers: z.record(z.string().max(500), z.string().max(10_000)) }),
]);

router.post("/code/threads/:id/requests/:rid", async (c) => {
  const { instance, nativeId, id } = thread(c);
  const requestId = c.req.param("rid");
  if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(requestId)) throw Boom.badRequest("Invalid request");
  const answer = await parseBody(c, answerSchema);
  await run(() => need(instance, "respond", "answer approvals")(nativeId, requestId, answer));
  await setAttention(id, null);
  hub().listChanged();
  return ok(c, { answered: true });
});

router.post("/code/threads/:id/recover", async (c) => {
  const { instance, nativeId } = thread(c);
  const { action } = await parseBody(
    c,
    z.object({ action: z.enum(["retry", "resume", "continue"]) }),
  );
  if (!instance.capabilities().turns.recovery.includes(action)) {
    throw toHttp(capabilityMissing(action));
  }
  await run(() => need(instance, "recover", action)(nativeId, action));
  return ok(c, { ok: true });
});

router.post("/code/threads/:id/queued/:qid/:action", async (c) => {
  const { instance, nativeId } = thread(c);
  const action = c.req.param("action");
  const queuedId = c.req.param("qid");
  if (action !== "send" && action !== "cancel") throw Boom.notFound("Unknown action");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(queuedId)) throw Boom.badRequest("Invalid queued id");
  await run(() => need(instance, "queued", "manage queued messages")(nativeId, action, queuedId));
  return ok(c, { ok: true });
});

router.post("/code/threads/:id/jobs/:job/kill", async (c) => {
  const { instance, nativeId } = thread(c);
  const job = c.req.param("job");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(job)) throw Boom.badRequest("Invalid job");
  await run(() => need(instance, "killJob", "stop background jobs")(nativeId, job));
  return ok(c, { ok: true });
});

const settingsSchema = z.strictObject({
  model: z.string().max(200).nullable().optional(),
  effort: z.string().max(20).nullable().optional(),
  permissionMode: permissionMode.nullable().optional(),
});

router.post("/code/threads/:id/settings", async (c) => {
  const { instance, nativeId } = thread(c);
  const change = await parseBody(c, settingsSchema);
  if (
    change.permissionMode &&
    !instance.capabilities().settings.permissionModes.includes(change.permissionMode)
  ) {
    throw Boom.badRequest("This agent does not offer that permission mode.");
  }
  return ok(
    c,
    await run(() => need(instance, "updateSettings", "change settings")(nativeId, change)),
  );
});

router.post("/code/threads/:id/archive", async (c) => {
  const { instance, nativeId, id } = thread(c);
  const { archived } = await parseBody(c, z.object({ archived: z.boolean() }));
  const result = await run(() => need(instance, "archive", "archive")(nativeId, archived));
  await db.update(codeThreads).set({ archived }).where(eq(codeThreads.id, id));
  const moved = result.moved.map((child) => threadKey(instance.id, child));
  for (const threadId of new Set([id, ...moved])) await onThreadArchived(threadId, archived);
  void hub().refresh(instance.id);
  return ok(c, { moved });
});

router.delete("/code/threads/:id", async (c) => {
  const { instance, nativeId, id } = thread(c);
  await run(() => need(instance, "remove", "delete threads")(nativeId));
  await onProjectThreadDeleted(id);
  await db.delete(codeThreads).where(eq(codeThreads.id, id));
  void hub().refresh(instance.id);
  return ok(c, { deleted: true });
});

router.post("/code/threads/:id/rename", async (c) => {
  const { instance, nativeId, id } = thread(c);
  const { title } = await parseBody(c, z.object({ title: z.string().trim().min(1).max(200) }));
  await run(() => need(instance, "rename", "rename threads")(nativeId, title));
  await db.update(codeThreads).set({ title }).where(eq(codeThreads.id, id));
  void hub().refresh(instance.id);
  return ok(c, { title });
});

router.get("/code/harnesses/:instance/models", async (c) =>
  ok(c, await run(() => harness(c).models())),
);

router.get("/code/harnesses/:instance/skills", async (c) => {
  const instance = harness(c);
  const cwd = query(c, "cwd")!;
  const threadId = query(c, "threadId", false);
  const nativeId = threadId ? hub().resolve(threadId)?.nativeId : undefined;
  return ok(c, await run(() => need(instance, "skills", "list skills")(cwd, nativeId)));
});

router.get("/code/harnesses/:instance/find-files", async (c) => {
  const instance = harness(c);
  const content = c.req.query("content") === "only" ? "only" : undefined;
  return ok(
    c,
    await run(() =>
      need(instance, "findFiles", "find files")(
        query(c, "dir")!,
        query(c, "q", false) ?? "",
        content,
      ),
    ),
  );
});

const uploadBodyLimit = routeBodyLimit(UPLOAD_MAX_BYTES, {
  onError: () => {
    throw Boom.entityTooLarge("Uploads are limited to 25 MB");
  },
});

router.post("/code/uploads/:instance", uploadBodyLimit, async (c) => {
  const instance = harness(c);
  const filename = query(c, "filename")!;
  if (filename.length > 255 || /[/\\\0]/.test(filename)) throw Boom.badRequest("Invalid filename");
  const body = await c.req.arrayBuffer();
  const file = new Blob([body], {
    type: c.req.header("content-type") ?? "application/octet-stream",
  });
  return ok(c, await run(() => need(instance, "upload", "take uploads")(file, filename)), 201);
});

router.get("/code/harnesses/:instance/asset", async (c) => {
  const instance = harness(c);
  const ref = query(c, "ref")!;
  return passthrough(await run(() => need(instance, "asset", "serve files")(ref)));
});

export default router;
