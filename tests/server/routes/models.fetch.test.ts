import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import {
  guardedFetch,
  OutboundRefusedError,
} from "../../../apps/web/src/server/api/models/models.fetch";

let server: Server;
let origin = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/to-metadata") {
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" }).end();
      return;
    }
    if (req.url === "/to-loop") {
      res.writeHead(302, { location: "/to-loop" }).end();
      return;
    }
    if (req.url === "/to-answer") {
      res.writeHead(302, { location: "/answer" }).end();
      return;
    }
    if (req.url === "/answer") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, path: req.url }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
afterEach(() => vi.unstubAllGlobals());

const PUBLIC_BASE = "http://203.0.113.9/v1";

describe("guardedFetch", () => {
  it("refuses a redirect to a private address when the account allows none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: "http://169.254.169.254/latest/meta-data/" },
          }),
      ),
    );
    await expect(
      guardedFetch(
        `${PUBLIC_BASE}/chat/completions`,
        { method: "POST", body: "{}" },
        { allowPrivateNetwork: false },
      ),
    ).rejects.toThrow(OutboundRefusedError);
  });

  it("still follows a redirect that stays public, and one to a private address the account allows", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url === `${PUBLIC_BASE}/chat/completions`) {
          return new Response(null, { status: 302, headers: { location: `${PUBLIC_BASE}/v2` } });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
    const response = await guardedFetch(
      `${PUBLIC_BASE}/chat/completions`,
      { method: "POST", body: "{}" },
      { allowPrivateNetwork: false },
    );
    expect(response.status).toBe(200);
    expect(calls).toEqual([`${PUBLIC_BASE}/chat/completions`, `${PUBLIC_BASE}/v2`]);
  });

  it("follows a same-origin redirect on a private endpoint the account allows", async () => {
    const response = await guardedFetch(
      `${origin}/to-answer`,
      { method: "POST", body: "{}" },
      { allowPrivateNetwork: true },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, path: "/answer" });
  });

  it("gives up after five hops", async () => {
    await expect(
      guardedFetch(`${origin}/to-loop`, { method: "GET" }, { allowPrivateNetwork: true }),
    ).rejects.toThrow(/redirected/);
  });
});
