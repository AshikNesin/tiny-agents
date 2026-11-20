import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { until } from "../../fixtures/until";

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: Buffer;
}

export interface FakeShelley {
  url: string;
  seen: Seen[];
  rows: Array<Record<string, unknown>>;
  archived: Array<Record<string, unknown>>;
  conversations: Map<string, { messages: unknown[]; conversation: Record<string, unknown> }>;
  push(frame: unknown): void;
  dropStreams(): void;
  openStreams(): number;
  waitForStreams(n: number, timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

export async function startFakeShelley(): Promise<FakeShelley> {
  const seen: Seen[] = [];
  const streams = new Set<ServerResponse>();
  const rows: Array<Record<string, unknown>> = [];
  const archived: Array<Record<string, unknown>> = [
    { conversation_id: "cOld", slug: "old", archived: true, tags: '["tiny-agents"]' },
  ];
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
      if (path === "/api/conversations/archived") return json(res, 200, archived);
      if (path === "/api/conversations/search") {
        const q = new URL(url, "http://x").searchParams;
        const list = q.get("archived") === "true" ? archived : rows;
        const term = q.get("q") ?? "";
        return json(
          res,
          200,
          list.filter((r) => !r.parent_conversation_id && String(r.slug).includes(term)),
        );
      }
      if (path === "/api/conversations/new") {
        created += 1;
        const id = `cNew${created}`;
        const parsed = JSON.parse(body.toString() || "{}") as { message?: string; cwd?: string };
        conversations.set(id, {
          messages: [],
          conversation: {
            conversation_id: id,
            slug: `task-${created}`,
            agent_working: true,
            prompt: parsed.message,
            cwd: parsed.cwd ?? null,
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
        if (action === "fork") {
          created += 1;
          const forkId = `cFork${created}`;
          const source = rows.find((r) => r.conversation_id === id);
          rows.push({ ...source, conversation_id: forkId, slug: null });
          return json(res, 201, { conversation_id: forkId });
        }
        if (action === "tags") {
          const tags = JSON.stringify((JSON.parse(body.toString()) as { tags: string[] }).tags);
          for (const r of [...rows, ...archived]) if (r.conversation_id === id) r.tags = tags;
          if (known) known.conversation.tags = tags;
          return json(res, 200, { conversation_id: id, tags });
        }
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
      if (path === "/api/models") {
        return json(res, 200, [
          { id: "claude-opus-5.5", ready: true },
          { id: "glm-5-3-zai-int-exe-xyz", display_name: "GLM 5.3", ready: true, is_default: true },
          { id: "offline", ready: false },
        ]);
      }
      if (path === "/api/model-costs") {
        const parsed = JSON.parse(body.toString() || "{}") as {
          models?: Array<{ model: string }>;
        };
        const costs: Record<string, unknown> = {};
        for (const m of parsed.models ?? [])
          costs[m.model] =
            m.model === "glm-5.3"
              ? { input: 0.079, output: 1.4, cache_read: 0.055, cache_write: 0 }
              : null;
        return json(res, 200, { costs });
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
    archived,
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
      await until(() => streams.size >= n, `${n} open streams`, timeoutMs);
    },
    close() {
      for (const res of streams) res.end();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
