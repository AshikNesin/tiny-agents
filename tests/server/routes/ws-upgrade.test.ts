import { createServer, request, type Server } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  createTicketStore,
  isOriginAllowed,
  onUpgrade,
  TICKET_TTL_MS,
} from "../../../apps/web/src/server/api/ws/upgrade";
import { authToken } from "../fixtures";

await authToken("ticket-owner-1@example.com", 1);
await authToken("ticket-owner-2@example.com", 2);

describe("ticket store", () => {
  afterEach(() => vi.useRealTimers());

  it("redeems once, only for a matching target, and never again", () => {
    const store = createTicketStore<{ userId: number; target: string }>();
    const ticket = store.issue({ userId: 1, target: "a" });
    expect(store.redeem(ticket, (t) => t.target === "a")).toEqual({ userId: 1, target: "a" });
    expect(store.redeem(ticket, (t) => t.target === "a")).toBeUndefined();
  });

  it("is spent by a mismatched attempt", () => {
    const store = createTicketStore<{ userId: number; target: string }>();
    const ticket = store.issue({ userId: 1, target: "a" });
    expect(store.redeem(ticket, (t) => t.target === "b")).toBeUndefined();
    expect(store.redeem(ticket, (t) => t.target === "a")).toBeUndefined();
  });

  it("expires after the TTL", () => {
    vi.useFakeTimers();
    const store = createTicketStore<{ userId: number }>();
    const ticket = store.issue({ userId: 1 });
    vi.advanceTimersByTime(TICKET_TTL_MS + 1);
    expect(store.redeem(ticket, () => true)).toBeUndefined();
  });

  it("caps live tickets per user with 429, counting only unexpired ones", () => {
    vi.useFakeTimers();
    const store = createTicketStore<{ userId: number }>({ perUserLimit: 2 });
    store.issue({ userId: 1 });
    store.issue({ userId: 1 });
    expect(() => store.issue({ userId: 1 })).toThrow(/Too many/);
    expect(() => store.issue({ userId: 2 })).not.toThrow();
    vi.advanceTimersByTime(TICKET_TTL_MS + 1);
    expect(() => store.issue({ userId: 1 })).not.toThrow();
  });

  it("is unguessable and unique", () => {
    const store = createTicketStore<{ userId: number }>();
    const tickets = new Set(Array.from({ length: 50 }, () => store.issue({ userId: 1 })));
    expect(tickets.size).toBe(50);
    for (const ticket of tickets) expect(ticket).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});

describe("isOriginAllowed", () => {
  const req = (headers: Record<string, string>) => ({ headers }) as never;

  it("allows no Origin (non-browser), the same host and a forwarded host", () => {
    expect(isOriginAllowed(req({ host: "app.test" }))).toBe(true);
    expect(isOriginAllowed(req({ host: "app.test", origin: "https://app.test" }))).toBe(true);
    expect(
      isOriginAllowed(
        req({ host: "internal", "x-forwarded-host": "app.test", origin: "https://app.test" }),
      ),
    ).toBe(true);
  });

  it("refuses a foreign or malformed Origin", () => {
    expect(isOriginAllowed(req({ host: "app.test", origin: "https://evil.test" }))).toBe(false);
    expect(isOriginAllowed(req({ host: "app.test", origin: "not a url" }))).toBe(false);
  });
});

describe("onUpgrade listener", () => {
  const PATH = /^\/api\/v1\/bots\/([^/]+)\/browser\/vnc$/;
  let server: Server;
  let port: number;

  const listen = async (build?: (server: Server) => void) => {
    server = createServer();
    onUpgrade(server, PATH, isOriginAllowed, ({ socket, params }) =>
      socket.end(
        `HTTP/1.1 200 OK\r\nContent-Length: ${params[0]!.length}\r\nConnection: close\r\n\r\n${params[0]!}`,
      ),
    );
    build?.(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;
  };

  function rawUpgrade(port: number, path: string) {
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request({
        port,
        path,
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Version": "13",
          "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        },
      });
      req.on("response", (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString() }),
        );
      });
      req.on("upgrade", (res, socket) => {
        socket.destroy();
        resolve({ status: res.statusCode!, body: "" });
      });
      req.on("error", reject);
      req.end();
    });
  }

  function rawRequest(raw: string) {
    return new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      const chunks: Buffer[] = [];
      socket.on("connect", () => socket.write(raw));
      socket.on("data", (chunk: Buffer) => chunks.push(chunk));
      socket.on("close", () => resolve(Buffer.concat(chunks).toString()));
      socket.on("error", reject);
    });
  }

  afterEach(async () => {
    await new Promise((resolve) => server?.close(resolve));
  });

  it("answers 400 to a malformed percent-encoded path and keeps serving upgrades", async () => {
    await listen();
    const reply = await rawRequest(
      "GET /api/v1/bots/%zz/browser/vnc HTTP/1.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
    );
    expect(reply.startsWith("HTTP/1.1 400")).toBe(true);
    const after = await rawUpgrade(port, "/api/v1/bots/%61lice/browser/vnc");
    expect(after.status).toBe(200);
    expect(after.body).toBe("alice");
  });

  it("rejects the upgrade instead of crashing when the handler throws", async () => {
    await listen((s) =>
      onUpgrade(s, /^\/boom$/, isOriginAllowed, () => {
        throw new Error("handler exploded");
      }),
    );
    expect((await rawUpgrade(port, "/boom")).status).toBe(500);
    expect((await rawUpgrade(port, "/api/v1/bots/%61lice/browser/vnc")).status).toBe(200);
  });
});
