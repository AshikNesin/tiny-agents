/**
 * The Code page's Shelley proxy against a fake Shelley: the allowlisted
 * calls reach it with the right paths and bodies, its errors keep their
 * meaning, and its SSE stream is relayed frame by frame.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";
import { api, createTestApp } from "../../helpers";
import { authToken } from "../../fixtures";

const token = await authToken("shelley-test@example.com");
const app = createTestApp();

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}
const seen: Seen[] = [];
let shelley: Server;
let shelleyUrl = "";

beforeAll(async () => {
  shelley = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
      const json = (status: number, value: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(value));
      };
      if (req.url?.startsWith("/api/conversations?")) {
        return json(200, [{ conversation_id: "cAbc", slug: "fix-tests" }]);
      }
      if (req.url === "/api/conversations/new") {
        return json(201, { status: "accepted", conversation_id: "cNew" });
      }
      if (req.url === "/api/conversation/cAbc/chat") return json(202, { status: "queued" });
      if (req.url === "/api/conversation/cGone/chat") {
        res.writeHead(404);
        return res.end("conversation not found");
      }
      if (req.url === "/api/conversation/cAbc/cancel") return json(200, { status: "cancelled" });
      if (req.url === "/api/conversation/cAbc/stream") {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ conversation_state: { working: true } })}\n\n`);
        res.write(`data: ${JSON.stringify({ stream_delta: { type: "text", text: "Hi" } })}\n\n`);
        return res.end();
      }
      res.writeHead(500);
      res.end("unexpected");
    });
  });
  await new Promise<void>((resolve) => shelley.listen(0, "127.0.0.1", resolve));
  shelleyUrl = `http://127.0.0.1:${(shelley.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => shelley.close(() => resolve())));

afterEach(() => {
  seen.length = 0;
  delete process.env.SHELLEY_URL;
});

describe("shelley proxy", () => {
  it("says when Shelley is not configured", async () => {
    const status = await api<{ configured: boolean }>(app, "/api/v1/shelley/status", { token });
    expect(status.body.data).toEqual({ configured: false, url: null });
    const list = await api(app, "/api/v1/shelley/conversations", { token });
    expect(list.status).toBe(503);
  });

  it("needs the owner's login", async () => {
    process.env.SHELLEY_URL = shelleyUrl;
    const response = await api(app, "/api/v1/shelley/conversations");
    expect(response.status).toBe(401);
    expect(seen).toHaveLength(0);
  });

  it("lists, starts, steers and stops conversations", async () => {
    process.env.SHELLEY_URL = `${shelleyUrl}/`;
    const list = await api<unknown[]>(app, "/api/v1/shelley/conversations", { token });
    expect(list.body.data).toEqual([{ conversation_id: "cAbc", slug: "fix-tests" }]);
    expect(seen[0].headers["x-shelley-request"]).toBe("1");

    const created = await api<{ conversationId: string }>(app, "/api/v1/shelley/conversations", {
      method: "POST",
      json: { message: "run the tests", cwd: "/repo" },
      token,
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toEqual({ conversationId: "cNew" });
    expect(JSON.parse(seen[1].body)).toEqual({ message: "run the tests", cwd: "/repo" });

    const chat = await api<{ status: string }>(app, "/api/v1/shelley/conversations/cAbc/chat", {
      method: "POST",
      json: { message: "use pnpm", queue: true },
      token,
    });
    expect(chat.body.data).toEqual({ status: "queued" });
    expect(JSON.parse(seen[2].body)).toEqual({ message: "use pnpm", queue: true });

    const cancel = await api(app, "/api/v1/shelley/conversations/cAbc/cancel", {
      method: "POST",
      token,
    });
    expect(cancel.status).toBe(200);
    expect(seen[3]).toMatchObject({ method: "POST", url: "/api/conversation/cAbc/cancel" });
  });

  it("keeps Shelley's 4xx answers and rejects odd ids before calling it", async () => {
    process.env.SHELLEY_URL = shelleyUrl;
    const gone = await api(app, "/api/v1/shelley/conversations/cGone/chat", {
      method: "POST",
      json: { message: "hello" },
      token,
    });
    expect(gone.status).toBe(404);
    const odd = await api(app, "/api/v1/shelley/conversations/..%2Fx/cancel", {
      method: "POST",
      token,
    });
    expect(odd.status).toBe(400);
    expect(seen).toHaveLength(1);
  });

  it("relays the conversation stream frame by frame", async () => {
    process.env.SHELLEY_URL = shelleyUrl;
    const response = await app.request("/api/v1/shelley/conversations/cAbc/stream", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.headers.get("content-type")).toMatch(/text\/event-stream/);
    const text = await response.text();
    const frames = text
      .split("\n\n")
      .filter((f) => f.startsWith("data:"))
      .map((f) => JSON.parse(f.slice(5)));
    expect(frames).toEqual([
      { conversation_state: { working: true } },
      { stream_delta: { type: "text", text: "Hi" } },
    ]);
  });
});
