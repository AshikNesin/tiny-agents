/**
 * A fake 1Password Connect server (the REST subset the vault uses): vaults,
 * items, per-token vault visibility and read/write permission.
 */
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
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
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const token = (req.get("authorization") ?? "").replace(/^Bearer /, "");
    state.requests.push({ method: req.method, path: req.path, token });
    const grant = state.tokens.get(token);
    if (!grant) {
      res.status(401).json({ status: 401, message: "Invalid token" });
      return;
    }
    const vault = req.path.match(/^\/v1\/vaults\/([^/]+)/)?.[1];
    if (vault && !grant.vaults.includes(vault)) {
      res.status(403).json({ status: 403, message: "No access" });
      return;
    }
    if (req.method !== "GET" && !grant.write) {
      res.status(403).json({ status: 403, message: "Read only" });
      return;
    }
    next();
  });
  app.get("/v1/vaults", (req, res) => {
    const grant = state.tokens.get((req.get("authorization") ?? "").slice(7))!;
    res.json(state.vaults.filter((v) => grant.vaults.includes(v.id)));
  });
  app.get("/v1/vaults/:vault/items", (req, res) => {
    res.json(
      [...state.items.values()]
        .filter((item) => item.vault.id === req.params.vault)
        .map(({ fields: _fields, ...summary }) => summary),
    );
  });
  app.get("/v1/vaults/:vault/items/:id", (req, res) => {
    const item = state.items.get(req.params.id);
    if (!item || item.vault.id !== req.params.vault) {
      res.status(404).json({ status: 404, message: "Not found" });
      return;
    }
    res.json(item);
  });
  app.post("/v1/vaults/:vault/items", (req, res) => {
    const item = { ...(req.body as ConnectItem), id: randomUUID() };
    state.items.set(item.id, item);
    res.json(item);
  });
  app.put("/v1/vaults/:vault/items/:id", (req, res) => {
    if (!state.items.has(req.params.id)) {
      res.status(404).end();
      return;
    }
    state.items.set(req.params.id, { ...(req.body as ConnectItem), id: req.params.id });
    res.json(state.items.get(req.params.id));
  });
  app.delete("/v1/vaults/:vault/items/:id", (req, res) => {
    state.items.delete(req.params.id);
    res.status(204).end();
  });
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    ...state,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
