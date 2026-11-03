/**
 * A fake Shelley for server tests (issue #143), speaking the wire format a
 * real Shelley (6c48a83) speaks: `/api/stream2` SSE frames, the snapshot,
 * conversations, chat (inject vs queue), git diffs and raw uploads. Tests
 * push stream frames and read what the app sent.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: Buffer;
}

export interface FakeShelley {
  url: string;
  seen: Seen[];
  rows: Array<Record<string, unknown>>;
  conversations: Map<string, { messages: unknown[]; conversation: Record<string, unknown> }>;
  /** Send a stream2 frame to every open stream. */
  push(frame: unknown): void;
  /** End every open stream (the hub must reconnect). */
  dropStreams(): void;
  openStreams(): number;
  /** Wait until `n` streams are open. */
  waitForStreams(n: number, timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

export async function startFakeShelley(): Promise<FakeShelley> {
  const seen: Seen[] = [];
  const streams = new Set<ServerResponse>();
  const rows: Array<Record<string, unknown>> = [];
  const conversations = new Map<
    string,
    { messages: unknown[]; conversation: Record<string, unknown> }
  >();
  let created = 0;

  const json = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(value));
  };

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const url = req.url ?? "";
      seen.push({ method: req.method ?? "", url, headers: req.headers, body });
      const path = url.split("?")[0];

      if (path === "/api/stream2") {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(
          `data: ${JSON.stringify({ conversation_list_patch: { reset: true, patch: [] } })}\n\n`,
        );
        streams.add(res);
        res.on("close", () => streams.delete(res));
        return;
      }
      if (path === "/api/conversations/snapshot")
        return json(res, 200, { conversations: rows, hash: "h" });
      if (path === "/api/conversations/archived")
        return json(res, 200, [{ conversation_id: "cOld", slug: "old", archived: true }]);
      if (path === "/api/conversations/new") {
        created += 1;
        const id = `cNew${created}`;
        const parsed = JSON.parse(body.toString() || "{}") as { message?: string };
        conversations.set(id, {
          messages: [],
          conversation: {
            conversation_id: id,
            slug: `task-${created}`,
            agent_working: true,
            prompt: parsed.message,
          },
        });
        return json(res, 201, { status: "accepted", conversation_id: id });
      }
      const conv = /^\/api\/conversation\/([\w-]+)(?:\/(.+))?$/.exec(path);
      if (conv) {
        const [, id, action] = conv;
        const known = conversations.get(id);
        if (!action) return known ? json(res, 200, known) : json(res, 404, { error: "not found" });
        if (action === "subagents") return json(res, 200, []);
        if (action === "chat") {
          if (!known) {
            res.writeHead(404);
            return res.end("conversation not found");
          }
          const parsed = JSON.parse(body.toString() || "{}") as { queue?: boolean };
          return json(res, parsed.queue ? 202 : 201, {
            status: parsed.queue ? "queued" : "accepted",
          });
        }
        return json(res, 200, { status: "ok" });
      }
      if (path.startsWith("/api/git/file-diff/")) {
        return json(res, 200, {
          path: decodeURIComponent(path.split("/").slice(5).join("/")),
          oldContent: "a\n",
          newContent: "b\n",
        });
      }
      if (path === "/api/git/diffs/working/files") {
        return json(res, 200, [
          { path: "math.js", status: "modified", additions: 4, deletions: 0, isGenerated: false },
        ]);
      }
      if (path === "/api/upload/raw") return json(res, 200, { path: "/tmp/shelley-uploads/x.png" });
      if (path === "/api/read") {
        res.writeHead(200, { "Content-Type": "image/png" });
        return res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      }
      res.writeHead(500);
      res.end(`unexpected ${req.method} ${url}`);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    url,
    seen,
    rows,
    conversations,
    push(frame) {
      for (const res of streams) res.write(`data: ${JSON.stringify(frame)}\n\n`);
    },
    dropStreams() {
      for (const res of streams) res.end();
      streams.clear();
    },
    openStreams: () => streams.size,
    async waitForStreams(n, timeoutMs = 5000) {
      const start = Date.now();
      while (streams.size < n) {
        if (Date.now() - start > timeoutMs) throw new Error(`only ${streams.size} streams open`);
        await new Promise((r) => setTimeout(r, 10));
      }
    },
    close() {
      for (const res of streams) res.end();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Poll until `check` passes (or throw after `timeoutMs`). */
export async function eventually(
  check: () => void | Promise<void>,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      await check();
      return;
    } catch (error) {
      if (Date.now() - start > timeoutMs) throw error;
      await new Promise((r) => setTimeout(r, 20));
    }
  }
}
