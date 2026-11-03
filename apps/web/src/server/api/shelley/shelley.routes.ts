/**
 * The Code page's window onto Shelley (https://github.com/boldsoftware/shelley),
 * the coding agent running on another machine (usually reached over
 * Tailscale). tiny-agents runs no agent loop for it: these routes forward a
 * small allowlist of Shelley's HTTP API — list, start, steer, stop, and the
 * live per-conversation event stream — so the browser only ever talks to this
 * app, under its own login, and Shelley never has to be exposed to the browser.
 *
 * Shelley's API contract: API.md in its repository.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AppContext, AppEnv } from "@groot/core/types";
import { Boom, HttpError } from "@groot/core/errors";
import { ok } from "@groot/core/utils/api-response.utils";
import { parseBody } from "@groot/core/utils/controller.utils";
import { appEnv } from "../../env";
import { openSse } from "../bots/bots.sse";

const REQUEST_TIMEOUT_MS = 20_000;
const LIST_LIMIT = 50;

/** Shelley ids are short slugs (`cXYZ123`); anything else never reaches its URL. */
const conversationIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

const newConversationSchema = z.object({
  message: z.string().trim().min(1).max(100_000),
  cwd: z.string().trim().max(1024).optional(),
  model: z.string().trim().max(200).optional(),
});

const chatSchema = z.object({
  message: z.string().trim().min(1).max(100_000),
  /** true: hold the message until the running turn ends instead of steering it now. */
  queue: z.boolean().optional(),
});

interface ShelleyConfig {
  url: string;
  token?: string;
}

function shelleyConfig(): ShelleyConfig | undefined {
  const { SHELLEY_URL, SHELLEY_TOKEN } = appEnv();
  const url = SHELLEY_URL?.trim().replace(/\/+$/, "");
  if (!url) return undefined;
  return { url, token: SHELLEY_TOKEN?.trim() || undefined };
}

/**
 * One request to Shelley's `/api`. Shelley's 4xx answers (a bad model, an
 * archived conversation) keep their status and text; network failures and
 * its 5xx become 502s that say what went wrong.
 */
async function shelley(
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<Response> {
  const config = shelleyConfig();
  if (!config) throw Boom.unavailable("Shelley is not configured: set SHELLEY_URL.");
  const headers: Record<string, string> = {
    // Shelley's optional require-header guard; harmless when it is off.
    "X-Shelley-Request": "1",
  };
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${config.url}/api${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw Boom.badGateway(`Shelley is unreachable at ${config.url}: ${reason}`);
  }
  if (!response.ok) {
    const text = (await response.text().catch(() => "")).trim().slice(0, 500);
    const message = `Shelley answered ${response.status}${text ? `: ${text}` : ""}`;
    if (response.status >= 400 && response.status < 500) {
      throw new HttpError(response.status, message);
    }
    throw Boom.badGateway(message);
  }
  return response;
}

async function shelleyJson<T = unknown>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const response = await shelley(path, init);
  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}

function conversationId(c: AppContext): string {
  const parsed = conversationIdSchema.safeParse(c.req.param("id"));
  if (!parsed.success) throw Boom.badRequest("Invalid conversation id");
  return parsed.data;
}

/**
 * Re-emit each `data:` frame of Shelley's SSE body as one event on `write`,
 * until the body ends (or the read fails, e.g. the fetch was aborted).
 */
export async function relaySseFrames(
  body: ReadableStream<Uint8Array>,
  write: (event: unknown) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      try {
        write(JSON.parse(data));
      } catch {
        // A malformed frame is skipped, not fatal.
      }
    }
  }
}

const router = new Hono<AppEnv>();

router.get("/shelley/status", (c) => {
  const config = shelleyConfig();
  return ok(c, { configured: Boolean(config), url: config?.url ?? null });
});

router.get("/shelley/models", async (c) => ok(c, await shelleyJson("/models")));

router.get("/shelley/conversations", async (c) =>
  ok(c, await shelleyJson(`/conversations?limit=${LIST_LIMIT}`)),
);

router.post("/shelley/conversations", async (c) => {
  const { message, cwd, model } = await parseBody(c, newConversationSchema);
  const created = await shelleyJson<{ conversation_id?: string }>("/conversations/new", {
    method: "POST",
    body: { message, ...(cwd ? { cwd } : {}), ...(model ? { model } : {}) },
  });
  if (!created.conversation_id) throw Boom.badGateway("Shelley did not return a conversation id");
  return ok(c, { conversationId: created.conversation_id }, 201);
});

router.post("/shelley/conversations/:id/chat", async (c) => {
  const id = conversationId(c);
  const { message, queue } = await parseBody(c, chatSchema);
  // While a turn runs, Shelley injects the message into it (steering);
  // `queue` holds it for the next turn instead.
  const result = await shelleyJson<{ status?: string }>(`/conversation/${id}/chat`, {
    method: "POST",
    body: { message, ...(queue ? { queue: true } : {}) },
  });
  return ok(c, { status: result.status ?? "accepted" });
});

router.post("/shelley/conversations/:id/cancel", async (c) => {
  const id = conversationId(c);
  await shelley(`/conversation/${id}/cancel`, { method: "POST" });
  return ok(c, { cancelled: true });
});

/**
 * The live transcript: Shelley replays the conversation's messages, then
 * streams new messages, working state, tool output and text deltas. Each
 * Shelley frame goes out as one event on our own SSE response (heartbeats,
 * shutdown and disconnect handled there). When Shelley's stream ends the
 * response ends too and the client reconnects for a fresh replay.
 */
router.get("/shelley/conversations/:id/stream", async (c) => {
  const id = conversationId(c);
  const upstream = new AbortController();
  // Connect before the SSE response opens so a 404 or 502 is a real API error.
  const response = await shelley(`/conversation/${id}/stream`, { signal: upstream.signal });
  if (!response.body) throw Boom.badGateway("Shelley returned an empty stream");
  const body = response.body;
  return openSse(c, async (sse) => {
    sse.onClose(() => upstream.abort());
    try {
      await relaySseFrames(body, (event) => sse.write(event));
    } catch {
      // Upstream aborted or dropped: the client's reconnect replays.
    }
    sse.end();
  });
});

export default router;
