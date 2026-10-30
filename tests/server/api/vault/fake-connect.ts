/**
 * A fake 1Password Connect server (the REST subset the vault uses): vaults,
 * items, per-token vault visibility and read/write permission.
 */
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import type { ConnectItem } from "../../../../apps/web/src/server/api/vault/backends/onepassword-mapping";

export interface FakeConnect {
  url: string;
  items: Map<string, ConnectItem>;
  /** token → vaults it sees and whether it may write. */
  tokens: Map<string, { vaults: string[]; write: boolean }>;
  vaults: { id: string; name: string }[];
  requests: { method: string; path: string; token: string }[];
  close(): Promise<void>;
}

export async function startFakeConnect(): Promise<FakeConnect> {
  const state = {
    items: new Map<string, ConnectItem>(),
    tokens: new Map<string, { vaults: string[]; write: boolean }>(),
    vaults: [
      { id: "vault-agents", name: "tiny-agents" },
      { id: "vault-other", name: "Family" },
    ],
    requests: [] as { method: string; path: string; token: string }[],
  };
  const app = new Hono();
  app.use(async (c, next) => {
    const token = (c.req.header("authorization") ?? "").replace(/^Bearer /, "");
    state.requests.push({ method: c.req.method, path: c.req.path, token });
    const grant = state.tokens.get(token);
    if (!grant) return c.json({ status: 401, message: "Invalid token" }, 401);
    const vault = c.req.path.match(/^\/v1\/vaults\/([^/]+)/)?.[1];
    if (vault && !grant.vaults.includes(vault)) {
      return c.json({ status: 403, message: "No access" }, 403);
    }
    if (c.req.method !== "GET" && !grant.write) {
      return c.json({ status: 403, message: "Read only" }, 403);
    }
    await next();
  });
  app.get("/v1/vaults", (c) => {
    const grant = state.tokens.get((c.req.header("authorization") ?? "").slice(7))!;
    return c.json(state.vaults.filter((v) => grant.vaults.includes(v.id)));
  });
  app.get("/v1/vaults/:vault/items", (c) =>
    c.json(
      [...state.items.values()]
        .filter((item) => item.vault.id === c.req.param("vault"))
        .map(({ fields: _fields, ...summary }) => summary),
    ),
  );
  app.get("/v1/vaults/:vault/items/:id", (c) => {
    const item = state.items.get(c.req.param("id"));
    if (!item || item.vault.id !== c.req.param("vault")) {
      return c.json({ status: 404, message: "Not found" }, 404);
    }
    return c.json(item);
  });
  app.post("/v1/vaults/:vault/items", async (c) => {
    const item = { ...(await c.req.json<ConnectItem>()), id: randomUUID() };
    state.items.set(item.id, item);
    return c.json(item);
  });
  app.put("/v1/vaults/:vault/items/:id", async (c) => {
    const id = c.req.param("id");
    if (!state.items.has(id)) return c.body(null, 404);
    state.items.set(id, { ...(await c.req.json<ConnectItem>()), id });
    return c.json(state.items.get(id));
  });
  app.delete("/v1/vaults/:vault/items/:id", (c) => {
    state.items.delete(c.req.param("id"));
    return c.body(null, 204);
  });
  const server: Server = createServer(getRequestListener(app.fetch));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    ...state,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
