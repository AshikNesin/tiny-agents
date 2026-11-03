/**
 * The Code page's window onto Shelley (issue #143): a curated allowlist of
 * Shelley's official API, under this app's login. Each route forwards to one
 * Shelley endpoint; ids are validated and paths encoded before they reach a
 * URL. Shelley admin (profiles, models, MCP, integrations), terminals and
 * file writes are deliberately absent: they stay in Shelley's own UI.
 *
 * Live updates come from the hub (one `stream2` connection for the whole
 * app), fanned out on `GET /shelley/events`.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AppContext, AppEnv } from "@groot/core/types";
import { Boom } from "@groot/core/errors";
import { ok } from "@groot/core/utils/api-response.utils";
import { parseBody } from "@groot/core/utils/controller.utils";
import { openSse } from "../bots/bots.sse";
import { shelleyConfig, shelleyFetch, shelleyJson } from "./shelley.client";
import { shelleyHub, type ShelleyRow } from "./shelley.hub";
import { follow, markSeen, seenMap } from "./shelley.service";

const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const diffIdSchema = z.string().regex(/^(working|[0-9a-f]{4,64})$/);

function param(c: AppContext, name: string, schema: z.ZodType<string> = idSchema): string {
  const parsed = schema.safeParse(c.req.param(name));
  if (!parsed.success) throw Boom.badRequest(`Invalid ${name}`);
  return parsed.data;
}

function query(c: AppContext, name: string, required = true): string | undefined {
  const value = c.req.query(name);
  if (required && !value) throw Boom.badRequest(`${name} is required`);
  if (value && value.length > 4096) throw Boom.badRequest(`${name} is too long`);
  return value || undefined;
}

function qs(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : "";
}

/** A repo-relative path, encoded per segment for Shelley's `file-diff/<id>/<path>`. */
function encodePath(path: string): string {
  if (path.split("/").some((segment) => segment === ".." || segment === ".")) {
    throw Boom.badRequest("Invalid path");
  }
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/** Snapshot rows plus what tiny-agents knows: followed and unread. */
async function decorate(rows: ShelleyRow[]) {
  const seen = await seenMap();
  return rows.map((row) => {
    const last = seen.get(row.conversation_id);
    const working = Boolean(row.working ?? row.agent_working);
    return {
      ...row,
      working,
      followed: last !== undefined,
      unread: last !== undefined && !working && (row.max_sequence_id ?? 0) > last,
    };
  });
}

async function activeList() {
  const hub = shelleyHub();
  if (!hub) throw Boom.unavailable("Shelley is not configured: set SHELLEY_URL.");
  if (!hub.list()) await hub.refreshList();
  const rows = hub.list();
  if (!rows) throw Boom.badGateway("Shelley's conversation list is not available yet");
  return decorate(rows);
}

/** Forward a binary GET (files, images) with its content type. */
async function passthrough(path: string): Promise<Response> {
  const upstream = await shelleyFetch(path);
  const headers = new Headers();
  for (const name of ["content-type", "content-length", "last-modified", "etag"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("cache-control", "private, max-age=300");
  headers.set("x-content-type-options", "nosniff");
  // Never let a file Shelley serves run as a page of this app.
  headers.set("content-security-policy", "sandbox; default-src 'none'; img-src 'self' data:");
  return new Response(upstream.body, { status: 200, headers });
}

const message = z.string().trim().min(1).max(100_000);

const newConversationSchema = z.object({
  message,
  cwd: z.string().trim().max(1024).optional(),
  model: z.string().trim().max(200).optional(),
  thinkingLevel: z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
});

const chatSchema = z.object({
  message,
  /** true: hold the message until the running turn ends instead of steering it now. */
  queue: z.boolean().optional(),
  skills: z.array(z.string().max(200)).max(20).optional(),
});

const settingsSchema = z
  .object({
    model: z.string().max(200).optional(),
    thinking_level: z.string().max(20).optional(),
  })
  .strict();

const router = new Hono<AppEnv>();

// --- status and live events ---------------------------------------------------

router.get("/shelley/status", (c) => {
  const config = shelleyConfig();
  const hub = shelleyHub();
  return ok(c, {
    configured: Boolean(config),
    // "Open in Shelley": the same address, reachable from the owner's tailnet.
    publicUrl: config?.url ?? null,
    connection: hub?.status() ?? { state: "disabled" },
  });
});

/**
 * One SSE per open Code page: `status` and `list` events always, plus
 * `frame` events for `?conversation=` (Shelley's stream2 frames for it).
 */
router.get("/shelley/events", (c) => {
  const hub = shelleyHub();
  if (!hub) throw Boom.unavailable("Shelley is not configured: set SHELLEY_URL.");
  const raw = c.req.query("conversation");
  const conversationId = raw ? idSchema.safeParse(raw).data : undefined;
  if (raw && !conversationId) throw Boom.badRequest("Invalid conversation");
  // `list=0`: a conversation view's own stream; the app-wide one carries the list.
  const withList = c.req.query("list") !== "0";
  return openSse(c, async (sse) => {
    const sendList = async () => {
      const rows = hub.list();
      if (rows) sse.write({ type: "list", conversations: await decorate(rows) });
    };
    sse.onClose(
      hub.onChange((change) => {
        if (change === "status") sse.write({ type: "status", connection: hub.status() });
        else if (withList) void sendList();
      }),
    );
    if (conversationId) {
      sse.onClose(hub.subscribe(conversationId, (frame) => sse.write({ type: "frame", frame })));
    }
    sse.write({ type: "status", connection: hub.status() });
    if (!withList) return;
    if (!hub.list()) await hub.refreshList();
    await sendList();
  });
});

// --- lists ----------------------------------------------------------------------

router.get("/shelley/conversations", async (c) => {
  if (c.req.query("view") === "archived") {
    const rows = await shelleyJson<ShelleyRow[]>("/conversations/archived");
    return ok(c, await decorate(Array.isArray(rows) ? rows : []));
  }
  return ok(c, await activeList());
});

router.get("/shelley/conversations/search", async (c) => {
  const q = query(c, "q")!;
  const archived = c.req.query("archived") === "true" ? "true" : undefined;
  return ok(c, await shelleyJson(`/conversations/search${qs({ q, archived })}`));
});

router.get("/shelley/conversations/by-slug/:slug", async (c) => {
  const slug = param(c, "slug", z.string().regex(/^[A-Za-z0-9_-]{1,200}$/));
  return ok(c, await shelleyJson(`/conversation-by-slug/${encodeURIComponent(slug)}`));
});

// --- one conversation ------------------------------------------------------------

router.get("/shelley/conversations/:id", async (c) => {
  const id = param(c, "id");
  const [conversation, subagents] = await Promise.all([
    shelleyJson<Record<string, unknown>>(`/conversation/${id}`),
    shelleyJson<unknown[]>(`/conversation/${id}/subagents`).catch(() => []),
  ]);
  return ok(c, { ...conversation, subagents: Array.isArray(subagents) ? subagents : [] });
});

for (const part of ["btw", "background-jobs", "subagent-usage", "settings"] as const) {
  router.get(`/shelley/conversations/:id/${part}`, async (c) =>
    ok(c, await shelleyJson(`/conversation/${param(c, "id")}/${part}`)),
  );
}

router.post("/shelley/conversations/:id/seen", async (c) => {
  const id = param(c, "id");
  const { sequenceId } = await parseBody(c, z.object({ sequenceId: z.number().int().min(0) }));
  await markSeen(id, sequenceId);
  return ok(c, { seen: sequenceId });
});

// --- start -----------------------------------------------------------------------

router.post("/shelley/conversations", async (c) => {
  const { message: text, cwd, model, thinkingLevel } = await parseBody(c, newConversationSchema);
  const created = await shelleyJson<{ conversation_id?: string }>("/conversations/new", {
    method: "POST",
    json: {
      message: text,
      ...(cwd ? { cwd } : {}),
      ...(model ? { model } : {}),
      ...(thinkingLevel ? { conversation_options: { thinking_level: thinkingLevel } } : {}),
    },
  });
  if (!created.conversation_id) throw Boom.badGateway("Shelley did not return a conversation id");
  await follow(created.conversation_id);
  void shelleyHub()?.refreshList();
  return ok(c, { conversationId: created.conversation_id }, 201);
});

router.post("/shelley/worktrees", async (c) => {
  const { cwd } = await parseBody(c, z.object({ cwd: z.string().trim().min(1).max(1024) }));
  return ok(c, await shelleyJson("/git/create-worktree", { method: "POST", json: { cwd } }), 201);
});

// --- steer -----------------------------------------------------------------------

router.post("/shelley/conversations/:id/chat", async (c) => {
  const id = param(c, "id");
  const { message: text, queue, skills } = await parseBody(c, chatSchema);
  // While a turn runs Shelley injects the message into it (steering);
  // `queue` holds it for when the turn ends.
  const result = await shelleyJson<{ status?: string }>(`/conversation/${id}/chat`, {
    method: "POST",
    json: {
      message: text,
      ...(queue ? { queue: true } : {}),
      ...(skills?.length ? { skills } : {}),
    },
  });
  await follow(id);
  return ok(c, { status: result.status ?? "accepted" });
});

/** Steer endpoints that take no body or a small fixed one. */
const actions: Record<string, z.ZodType<Record<string, unknown> | undefined>> = {
  cancel: z.undefined(),
  retry: z.undefined(),
  resume: z.undefined(),
  "new-generation": z.undefined(),
  archive: z.undefined(),
  unarchive: z.undefined(),
  delete: z.undefined(),
  continue: z.object({ model: z.string().max(200).optional() }),
  fork: z.object({
    message_id: z.string().max(128).optional(),
    sequence_id: z.number().optional(),
  }),
  cwd: z.object({ cwd: z.string().trim().min(1).max(1024) }),
  rename: z.object({ slug: z.string().trim().min(1).max(200) }),
  tags: z.object({ tags: z.array(z.string().max(100)).max(50) }),
  settings: settingsSchema,
};

/** Every subagent below `id` in `rows` (children, grandchildren, …). */
export function descendantIds(rows: ShelleyRow[], id: string): string[] {
  const children = new Map<string, string[]>();
  for (const row of rows) {
    const parent = row.parent_conversation_id;
    if (!parent) continue;
    const list = children.get(parent) ?? [];
    list.push(row.conversation_id);
    children.set(parent, list);
  }
  const found: string[] = [];
  const seen = new Set([id]);
  const queue = [id];
  while (queue.length > 0) {
    for (const child of children.get(queue.shift()!) ?? []) {
      if (seen.has(child)) continue; // a cycle in bad data must not loop
      seen.add(child);
      found.push(child);
      queue.push(child);
    }
  }
  return found;
}

/**
 * Shelley archives one conversation at a time; the Code page archives a
 * conversation with its subagents, so a finished task leaves the list whole.
 * Subagents are found in the list they are leaving (active for archive,
 * archived for unarchive) and moved best-effort after the parent.
 */
async function subagentsToMove(id: string, action: "archive" | "unarchive"): Promise<string[]> {
  try {
    if (action === "archive") {
      const hub = shelleyHub();
      if (hub && !hub.list()) await hub.refreshList();
      return descendantIds(hub?.list() ?? [], id);
    }
    const archived = await shelleyJson<ShelleyRow[]>("/conversations/archived");
    return descendantIds(Array.isArray(archived) ? archived : [], id);
  } catch {
    return [];
  }
}

for (const [action, schema] of Object.entries(actions)) {
  router.post(`/shelley/conversations/:id/${action}`, async (c) => {
    const id = param(c, "id");
    const body = schema instanceof z.ZodUndefined ? undefined : await parseBody(c, schema);
    const cascade =
      action === "archive" || action === "unarchive" ? await subagentsToMove(id, action) : [];
    const result = await shelleyJson(`/conversation/${id}/${action}`, {
      method: "POST",
      ...(body !== undefined ? { json: body } : {}),
    });
    // One subagent that will not move must not undo the parent's archive.
    const settled = await Promise.allSettled(
      cascade.map((child) => shelleyJson(`/conversation/${child}/${action}`, { method: "POST" })),
    );
    const moved = cascade.filter((_, i) => settled[i].status === "fulfilled");
    if (["archive", "unarchive", "delete", "rename", "fork"].includes(action)) {
      void shelleyHub()?.refreshList();
    }
    if ((action === "archive" || action === "unarchive") && result && typeof result === "object") {
      return ok(c, { ...result, subagents: moved });
    }
    return ok(c, result);
  });
}

const queuedActions = { send: "send-queued", cancel: "cancel-queued", retry: "retry-queued" };
for (const [action, upstream] of Object.entries(queuedActions)) {
  router.post(`/shelley/conversations/:id/queued/${action}`, async (c) => {
    const id = param(c, "id");
    const queuedId = c.req.query("queuedId");
    if (queuedId && !idSchema.safeParse(queuedId).success)
      throw Boom.badRequest("Invalid queuedId");
    if (!queuedId && action !== "cancel") throw Boom.badRequest("queuedId is required");
    return ok(
      c,
      await shelleyJson(`/conversation/${id}/${upstream}${qs({ queued_id: queuedId })}`, {
        method: "POST",
      }),
    );
  });
}

router.post("/shelley/conversations/:id/background-jobs/:job/kill", async (c) => {
  const id = param(c, "id");
  const job = param(c, "job");
  return ok(
    c,
    await shelleyJson(`/conversation/${id}/background-jobs/${job}/kill`, { method: "POST" }),
  );
});

// --- composer --------------------------------------------------------------------

router.get("/shelley/models", async (c) => ok(c, await shelleyJson("/models")));

router.get("/shelley/skills", async (c) =>
  ok(
    c,
    await shelleyJson(
      `/skills${qs({ cwd: query(c, "cwd")!, conversation_id: query(c, "conversationId", false) })}`,
    ),
  ),
);

router.get("/shelley/find-files", async (c) => {
  const content = c.req.query("content");
  return ok(
    c,
    await shelleyJson(
      `/find-files${qs({
        dir: query(c, "dir")!,
        q: query(c, "q", false),
        content: content === "only" || content === "skip" ? content : undefined,
        include_dirs: c.req.query("includeDirs") === "true" ? "true" : undefined,
      })}`,
    ),
  );
});

/** Raw upload (screenshots, logs): the body goes to Shelley as-is; answers `{ path }`. */
router.post("/shelley/uploads", async (c) => {
  const filename = query(c, "filename")!;
  if (filename.length > 255 || /[/\\\0]/.test(filename)) throw Boom.badRequest("Invalid filename");
  const length = Number(c.req.header("content-length") ?? "0");
  if (length > UPLOAD_MAX_BYTES) throw Boom.entityTooLarge("Uploads are limited to 25 MB");
  const body = await c.req.arrayBuffer();
  if (body.byteLength > UPLOAD_MAX_BYTES) throw Boom.entityTooLarge("Uploads are limited to 25 MB");
  const result = await shelleyJson<{ path?: string }>(`/upload/raw${qs({ filename })}`, {
    method: "POST",
    body: new Blob([body]),
    headers: { "Content-Type": c.req.header("content-type") ?? "application/octet-stream" },
    timeoutMs: 120_000,
  });
  if (!result.path) throw Boom.badGateway("Shelley did not return the uploaded path");
  return ok(c, { path: result.path }, 201);
});

// --- files and directories ---------------------------------------------------------

router.get("/shelley/repos", async (c) => ok(c, await shelleyJson("/git/repos")));

router.get("/shelley/directories", async (c) =>
  ok(c, await shelleyJson(`/list-directory${qs({ path: query(c, "path", false) })}`)),
);

router.get("/shelley/validate-cwd", async (c) =>
  ok(c, await shelleyJson(`/validate-cwd${qs({ path: query(c, "path")! })}`)),
);

router.get("/shelley/files", async (c) => passthrough(`/read${qs({ path: query(c, "path")! })}`));

router.get("/shelley/messages/:mid/image/:content/:result", async (c) => {
  const mid = param(c, "mid");
  const content = param(c, "content", z.string().regex(/^-?\d{1,4}$/));
  const result = param(c, "result", z.string().regex(/^-?\d{1,4}$/));
  return passthrough(`/message/${mid}/image/${content}/${result}`);
});

// --- diffs -------------------------------------------------------------------------

router.get("/shelley/diffs", async (c) =>
  ok(
    c,
    await shelleyJson(
      `/git/diffs${qs({ cwd: query(c, "cwd")!, commit: query(c, "commit", false) })}`,
    ),
  ),
);

router.get("/shelley/diffs/:diff/files", async (c) => {
  const diff = param(c, "diff", diffIdSchema);
  return ok(
    c,
    await shelleyJson(
      `/git/diffs/${diff}/files${qs({ cwd: query(c, "cwd")!, to: query(c, "to", false) })}`,
    ),
  );
});

router.get("/shelley/diffs/:diff/file", async (c) => {
  const diff = param(c, "diff", diffIdSchema);
  const path = encodePath(query(c, "path")!);
  return ok(
    c,
    await shelleyJson(
      `/git/file-diff/${diff}/${path}${qs({ cwd: query(c, "cwd")!, to: query(c, "to", false) })}`,
    ),
  );
});

export default router;
