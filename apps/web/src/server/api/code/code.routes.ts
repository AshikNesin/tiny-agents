/**
 * The Code page's API (ADR 0011): one route set for every harness, under
 * this app's login. A thread route picks its harness instance from the
 * thread id (`<instance>:<native>`); a harness route names the instance.
 * The browser never reaches a harness directly.
 *
 * A route whose harness lacks the capability answers 404
 * `capability_missing`; the UI hides those controls from `capabilities`.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AppContext, AppEnv } from "@groot/core/types";
import { Boom, HttpError } from "@groot/core/errors";
import { ok } from "@groot/core/utils/api-response.utils";
import { parseBody } from "@groot/core/utils/controller.utils";
import { routeBodyLimit } from "@groot/core/middlewares/body-limit.middleware";
import {
  HarnessError,
  capabilityMissing,
  threadIdOf,
  type HarnessInstance,
  type ThreadSummary,
} from "@tiny-agents/code/server";
import { openSse } from "../bots/bots.sse";
import {
  codeCapabilities,
  requireCodeAsset,
  requireCodeChange,
  type Viewer,
} from "../people/access";
import { codeHub, type CodeHub } from "./code.hub";
import { follow, markSeen, seenMap } from "./code.store";
import {
  getProject,
  onProjectThreadDeleted,
  projectThread,
  startProjectThread,
} from "./code.projects";
import { codeChanges } from "./code.changes";
import { codeGitHub } from "./code.github";
import { noteOwnerInput, onThreadArchived } from "./code.pulls";

const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

const router = new Hono<AppEnv>();

/** Harness errors keep their status and text; everything else is the app's. */
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
  const raw = c.req.param("id") ?? "";
  const target = hub().resolve(decodeURIComponent(raw));
  if (!target) throw Boom.notFound("No harness serves this thread");
  return { ...target, id: threadIdOf(target.instance.id, target.nativeId) };
}

/** The optional method, or 404 `capability_missing`. */
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

/** Never let something a harness serves run as a page of this app. */
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

function describe(instance: HarnessInstance, viewer: Viewer) {
  return {
    id: instance.id,
    kind: instance.kind,
    label: instance.label,
    status: instance.status(),
    capabilities: codeCapabilities(viewer, instance.capabilities()),
    commands: instance.commands?.() ?? [],
  };
}

// --- status and live list ------------------------------------------------------

router.get("/code/status", (c) => {
  const current = codeHub();
  const viewer = c.get("viewer");
  return ok(c, {
    harnesses: current ? current.instances().map((instance) => describe(instance, viewer)) : [],
  });
});

/** One SSE per open Code page: harness status and the merged thread list. */
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

// --- lists ---------------------------------------------------------------------------

async function decorate(rows: ThreadSummary[]): Promise<ThreadSummary[]> {
  const seen = await seenMap();
  return rows.map((row) => {
    const last = seen.get(row.id);
    return {
      ...row,
      followed: last !== undefined,
      unread: last !== undefined && !row.working && row.cursor > last,
    };
  });
}

router.get("/code/threads", async (c) => {
  const h = hub();
  if (c.req.query("view") !== "archived") return ok(c, await h.list());
  const lists = await Promise.all(
    h
      .instances()
      .filter((i) => i.capabilities().threads.archive)
      .map((i) => run(() => i.listThreads("archived")).catch(() => [] as ThreadSummary[])),
  );
  return ok(c, await decorate(lists.flat()));
});

router.get("/code/threads/search", async (c) => {
  const q = query(c, "q")!;
  const archived = c.req.query("archived") === "true";
  const lists = await Promise.all(
    hub()
      .instances()
      .filter((i) => i.capabilities().threads.search && i.searchThreads)
      .map((i) => run(() => i.searchThreads!(q, archived)).catch(() => [] as ThreadSummary[])),
  );
  return ok(c, await decorate(lists.flat()));
});

/** `/code/s/:slug` links: the thread whose title is exactly `title`. */
router.get("/code/threads/by-title/:title", async (c) => {
  const title = decodeURIComponent(c.req.param("title"));
  if (!title || title.length > 200) throw Boom.badRequest("Invalid title");
  const lists = await Promise.all(
    hub()
      .instances()
      .filter((i) => i.searchThreads)
      .map((i) => run(() => i.searchThreads!(title, false)).catch(() => [] as ThreadSummary[])),
  );
  const found = lists.flat().find((t) => t.title === title);
  if (!found) throw Boom.notFound("No thread has that title");
  return ok(c, found);
});

// --- start -----------------------------------------------------------------------------

const message = z.string().trim().min(1).max(100_000);
const refs = z.array(z.string().max(2048)).max(20).optional();
const permissionMode = z.enum(["default", "acceptEdits", "plan", "bypassPermissions"]);

const createSchema = z.object({
  /** Omitted with a project: its default harness. */
  instanceId: z.string().min(1).max(40).optional(),
  /** Start in a project (issue #297): its own worktree on a new branch. */
  projectId: z.string().min(1).max(64).optional(),
  /** With a project: check out this existing branch (a PR's head) instead. */
  branch: z.string().trim().min(1).max(250).optional(),
  message,
  cwd: z.string().trim().max(1024).optional(),
  model: z.string().trim().max(200).optional(),
  effort: z.string().trim().max(20).optional(),
  permissionMode: permissionMode.optional(),
  attachments: refs,
});

router.post("/code/threads", async (c) => {
  const body = await parseBody(c, createSchema);
  requireCodeChange(c.get("viewer"), body);
  const project = body.projectId ? await getProject(body.projectId) : undefined;
  const instanceId = body.instanceId ?? project?.defaultInstanceId ?? undefined;
  if (!instanceId) throw Boom.badRequest("Pick a harness.");
  const instance = hub().instance(instanceId);
  if (!instance) throw Boom.notFound("No such harness");
  const caps = instance.capabilities();
  if (!project && caps.workspace.requiresCwd && !body.cwd) {
    throw Boom.badRequest("Pick a working directory.");
  }
  if (body.permissionMode && !caps.settings.permissionModes.includes(body.permissionMode)) {
    throw Boom.badRequest("This harness does not offer that permission mode.");
  }
  const { instanceId: _instance, projectId: _project, branch, ...input } = body;
  const { nativeId } = project
    ? await run(() => startProjectThread(project, instance, { ...input, branch }))
    : await run(() => instance.createThread(input));
  await follow(instance.id, nativeId);
  void hub().refresh(instance.id);
  return ok(c, { threadId: threadIdOf(instance.id, nativeId) }, 201);
});

// --- one thread --------------------------------------------------------------------------

router.get("/code/threads/:id", async (c) => {
  const { instance, nativeId } = thread(c);
  return ok(c, await run(() => instance.getThread(nativeId)));
});

/** The thread live: a snapshot, then changed rows, partial text and state. */
router.get("/code/threads/:id/events", (c) => {
  const { id } = thread(c);
  const h = hub();
  return openSse(c, (sse) => {
    sse.onClose(h.watch(id, (event) => sse.write(event)));
  });
});

/**
 * Live refresh for the Changes and Review panels (ADR 0025): a new version
 * each time the thread's directory changes. A project thread watches its
 * worktree; any other thread its directory, through the harness.
 * Where neither can be stamped the stream says `unavailable` and the panel
 * re-reads on transcript activity instead.
 */
router.get("/code/threads/:id/changes", async (c) => {
  const { instance, id } = thread(c);
  const project = await projectThread(id);
  // The thread's own directory; only the owner may name another (a guest never chooses one).
  const cwd =
    (await hub().list()).find((row) => row.id === id)?.cwd ??
    (c.get("viewer").kind === "owner" ? query(c, "cwd", false) : undefined);
  let source: { key: string; stamp: () => Promise<string> } | undefined;
  if (project?.thread.worktree) {
    const worktree = project.thread.worktree;
    // No sandbox or no GitHub set up: unavailable, not an error the client retries.
    const ws = await codeGitHub()
      .workspace(project.project)
      .catch(() => undefined);
    if (ws) source = { key: `sandbox:${worktree}`, stamp: () => ws.changeStamp(worktree) };
  } else if (cwd && typeof instance.changeStamp === "function") {
    source = {
      key: `${instance.id}:${cwd}`,
      stamp: () => instance.changeStamp!(cwd),
    };
  }
  return openSse(c, (sse) => {
    if (!source) {
      sse.write({ type: "unavailable", message: "This thread's changes cannot be watched." });
      return;
    }
    sse.onClose(codeChanges().watch(source.key, source.stamp, (event) => sse.write(event)));
  });
});

router.post("/code/threads/:id/seen", async (c) => {
  const { instance, nativeId } = thread(c);
  const { cursor } = await parseBody(c, z.object({ cursor: z.number().int().min(0) }));
  await markSeen(instance.id, nativeId, cursor);
  return ok(c, { seen: cursor });
});

const sendSchema = z.object({
  message,
  attachments: refs,
  /** true: hold the message until the running turn ends instead of steering it now. */
  queue: z.boolean().optional(),
  skills: z.array(z.string().max(200)).max(20).optional(),
});

router.post("/code/threads/:id/messages", async (c) => {
  const { instance, nativeId } = thread(c);
  const body = await parseBody(c, sendSchema);
  const result = await run(() => instance.send(nativeId, body));
  await follow(instance.id, nativeId);
  // The owner's own words: a waiting Auto-fix loop may go on (issue #297 §9.4).
  if (c.get("viewer").kind === "owner") await noteOwnerInput(threadIdOf(instance.id, nativeId));
  return ok(c, result);
});

router.post("/code/threads/:id/interrupt", async (c) => {
  const { instance, nativeId } = thread(c);
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
  const { instance, nativeId } = thread(c);
  const requestId = c.req.param("rid");
  if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(requestId)) throw Boom.badRequest("Invalid request");
  const answer = await parseBody(c, answerSchema);
  await run(() => need(instance, "respond", "answer approvals")(nativeId, requestId, answer));
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
  requireCodeChange(c.get("viewer"), { permissionMode: change.permissionMode });
  if (
    change.permissionMode &&
    !instance.capabilities().settings.permissionModes.includes(change.permissionMode)
  ) {
    throw Boom.badRequest("This harness does not offer that permission mode.");
  }
  return ok(
    c,
    await run(() => need(instance, "updateSettings", "change settings")(nativeId, change)),
  );
});

router.post("/code/threads/:id/archive", async (c) => {
  const { instance, nativeId } = thread(c);
  const { archived } = await parseBody(c, z.object({ archived: z.boolean() }));
  const result = await run(() => need(instance, "archive", "archive")(nativeId, archived));
  void hub().refresh(instance.id);
  // Project threads: the worktree goes on archive and comes back on unarchive (§7.6).
  for (const native of [nativeId, ...result.moved]) {
    await onThreadArchived(threadIdOf(instance.id, native), archived).catch(() => undefined);
  }
  return ok(c, {
    moved: result.moved.map((child) => threadIdOf(instance.id, child)),
  });
});

router.delete("/code/threads/:id", async (c) => {
  const { instance, nativeId, id } = thread(c);
  await run(() => need(instance, "remove", "delete threads")(nativeId));
  await onProjectThreadDeleted(id).catch(() => undefined);
  void hub().refresh(instance.id);
  return ok(c, { deleted: true });
});

router.post("/code/threads/:id/rename", async (c) => {
  const { instance, nativeId } = thread(c);
  const { title } = await parseBody(c, z.object({ title: z.string().trim().min(1).max(200) }));
  await run(() => need(instance, "rename", "rename threads")(nativeId, title));
  void hub().refresh(instance.id);
  return ok(c, { title });
});

router.post("/code/threads/:id/cwd", async (c) => {
  const { instance, nativeId } = thread(c);
  const { cwd } = await parseBody(c, z.object({ cwd: z.string().trim().min(1).max(1024) }));
  await run(() => need(instance, "changeCwd", "change the directory")(nativeId, cwd));
  return ok(c, { cwd });
});

router.post("/code/threads/:id/fork", async (c) => {
  const { instance, nativeId } = thread(c);
  const { at } = await parseBody(c, z.object({ at: z.string().min(1).max(200) }));
  const forked = await run(() => need(instance, "fork", "fork threads")(nativeId, at));
  await follow(instance.id, forked.nativeId);
  void hub().refresh(instance.id);
  return ok(c, { threadId: threadIdOf(instance.id, forked.nativeId) }, 201);
});

router.get("/code/threads/:id/usage", async (c) => {
  const { instance, nativeId } = thread(c);
  return ok(c, await run(() => need(instance, "usage", "report usage")(nativeId)));
});

// --- one harness: composer and workspace ---------------------------------------------------

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

/** The raw body is capped before it is read, in place of the app's 1 MB API default. */
const uploadBodyLimit = routeBodyLimit(UPLOAD_MAX_BYTES, {
  onError: () => {
    throw Boom.entityTooLarge("Uploads are limited to 25 MB");
  },
});

/** Raw upload (screenshots, logs): answers the ref to attach. */
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
  requireCodeAsset(c.get("viewer"), ref);
  return passthrough(await run(() => need(instance, "asset", "serve files")(ref)));
});

router.get("/code/harnesses/:instance/directories", async (c) => {
  const instance = harness(c);
  return ok(
    c,
    await run(() => need(instance, "browse", "browse directories")(query(c, "path", false))),
  );
});

router.get("/code/harnesses/:instance/validate-cwd", async (c) => {
  const instance = harness(c);
  return ok(
    c,
    await run(() => need(instance, "validateCwd", "check directories")(query(c, "path")!)),
  );
});

router.get("/code/harnesses/:instance/repos", async (c) => {
  const instance = harness(c);
  return ok(c, { repos: instance.repos ? await run(() => instance.repos!()) : [] });
});

router.post("/code/harnesses/:instance/worktrees", async (c) => {
  const instance = harness(c);
  const { cwd } = await parseBody(c, z.object({ cwd: z.string().trim().min(1).max(1024) }));
  return ok(c, await run(() => need(instance, "createWorktree", "create worktrees")(cwd)), 201);
});

const diffIdSchema = z.string().regex(/^(working|[0-9a-f]{4,64})$/);

router.get("/code/harnesses/:instance/diffs", async (c) => {
  const instance = harness(c);
  return ok(c, await run(() => need(instance, "diffs", "show diffs")(query(c, "cwd")!)));
});

router.get("/code/harnesses/:instance/diffs/:diff/files", async (c) => {
  const instance = harness(c);
  const diff = diffIdSchema.safeParse(c.req.param("diff"));
  if (!diff.success) throw Boom.badRequest("Invalid diff");
  return ok(
    c,
    await run(() => need(instance, "diffFiles", "show diffs")(query(c, "cwd")!, diff.data)),
  );
});

router.get("/code/harnesses/:instance/diffs/:diff/file", async (c) => {
  const instance = harness(c);
  const diff = diffIdSchema.safeParse(c.req.param("diff"));
  if (!diff.success) throw Boom.badRequest("Invalid diff");
  const path = query(c, "path")!;
  if (path.split("/").some((s) => s === "..")) throw Boom.badRequest("Invalid path");
  return ok(
    c,
    await run(() => need(instance, "fileDiff", "show diffs")(query(c, "cwd")!, diff.data, path)),
  );
});

export default router;
