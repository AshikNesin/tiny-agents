/**
 * Settings → Models routes (issue #179): accounts, discovery, models, roles.
 * A local HTTP server stands in for an OpenAI-compatible endpoint (a private
 * address, so accounts opt in to private networks). The key never comes
 * back from any route and is never stored in the clear.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { generateToken } from "@groot/core/utils/jwt.utils";
import { hashPassword } from "@groot/core/utils/password.utils";
import {
  bots,
  db,
  modelRoles,
  models,
  providers,
  users,
  vaultItems,
} from "../../../apps/web/src/server/db";
import { setReadBackendsForTests } from "../../../apps/web/src/server/api/vault/backends";
import {
  createLocalBackend,
  type LocalStore,
} from "../../../apps/web/src/server/api/vault/backends/local";
import { setWriteBackendsForTests } from "../../../apps/web/src/server/api/vault/vault.admin.service";
import {
  clearStatusCache,
  forgetAppCredential,
} from "../../../apps/web/src/server/api/vault/vault.service";
import { clearStepUpsForTests } from "../../../apps/web/src/server/api/vault/vault.stepup";
import {
  bindModelRuntime,
  FAUX_PROVIDER_ID,
} from "../../../apps/web/src/server/api/models/models.config";
import { api, createTestApp } from "../helpers";
import { closeAppRuntime, openAppRuntime } from "../fixtures";

const SENTINEL = "sk-sentinel-Qz81LmWw";
const PASSWORD = "owner-password-models";

let server: Server;
let endpoint: string;
let seen: { path: string; auth?: string }[] = [];
let listed = ["model-a", "model-b"];

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({
      path: req.url ?? "",
      ...(req.headers.authorization ? { auth: req.headers.authorization } : {}),
    });
    if (req.headers.authorization !== `Bearer ${SENTINEL}`) {
      res.writeHead(401).end("{}");
      return;
    }
    if (req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: listed.map((id) => ({ id })) }));
      return;
    }
    if (req.url === "/redirect/models") {
      res.writeHead(302, { location: "http://169.254.169.254/" }).end();
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const app = createTestApp();
let token: string;

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({
      email: "models-owner@example.com",
      password: await hashPassword(PASSWORD),
      name: "O",
    })
    .returning();
  token = await generateToken({ userId: user!.id, email: user!.email });
});

let store: Map<string, string>;
beforeEach(async () => {
  store = new Map();
  const local: LocalStore = {
    get: async (key) => store.get(key),
    set: async (key, value) => void store.set(key, value),
    delete: async (key) => void store.delete(key),
  };
  const backend = createLocalBackend(local);
  setReadBackendsForTests(new Map([["local", backend]]));
  setWriteBackendsForTests(new Map([["local", backend]]));
  clearStatusCache();
  clearStepUpsForTests();
  forgetAppCredential();
  seen = [];
  listed = ["model-a", "model-b"];
  bindModelRuntime(await openAppRuntime());
});

afterEach(async () => {
  bindModelRuntime(undefined);
  await closeAppRuntime();
  await db.delete(bots);
  await db.delete(modelRoles);
  const ours = await db.select().from(providers);
  for (const row of ours.filter((p) => p.id !== FAUX_PROVIDER_ID)) {
    await db.delete(providers).where(eq(providers.id, row.id));
  }
  await db.delete(vaultItems);
});

// oxlint-disable-next-line typescript/no-explicit-any -- response data varies per route
type Data = any;

function call(
  path: string,
  init: { method?: string; json?: unknown; stepUp?: string; headers?: Record<string, string> } = {},
) {
  return api<Data>(app, `/api/v1${path}`, {
    method: init.method ?? "GET",
    token,
    ...(init.json !== undefined ? { json: init.json } : {}),
    headers: { ...(init.stepUp ? { "X-Vault-Step-Up": init.stepUp } : {}), ...init.headers },
  });
}

async function stepUp(): Promise<string> {
  const response = await call("/vault/step-up", { method: "POST", json: { password: PASSWORD } });
  expect(response.status).toBe(200);
  return response.body.data.token as string;
}

const connection = {
  kind: "openai-chat",
  apiKey: SENTINEL,
  allowPrivateNetwork: true,
};

async function createAccount(stepUpToken: string, extra: Record<string, unknown> = {}) {
  return call("/models/providers", {
    method: "POST",
    stepUp: stepUpToken,
    json: { ...connection, baseUrl: endpoint, name: "Local", models: ["model-a"], ...extra },
  });
}

/** Every place a key could leak: rows, vault rows, the KV store, the list. */
async function assertNoSentinel(): Promise<void> {
  const dumps = [
    JSON.stringify(await db.select().from(providers)),
    JSON.stringify(await db.select().from(models)),
    JSON.stringify(await db.select().from(vaultItems)),
    JSON.stringify([...store.values()]),
    JSON.stringify((await call("/models/providers")).body),
    JSON.stringify((await call("/models")).body),
  ];
  for (const dump of dumps) expect(dump).not.toContain(SENTINEL);
}

describe("models routes", () => {
  it("discovers without saving, then creates an account with step-up", async () => {
    const found = await call("/models/discover", {
      method: "POST",
      json: { ...connection, baseUrl: endpoint },
    });
    expect(found.status).toBe(200);
    expect(found.body.data.models.map((m: Data) => m.upstreamId)).toEqual(["model-a", "model-b"]);
    expect(await db.$count(providers, eq(providers.name, "Local"))).toBe(0);

    expect((await createAccount("")).status).toBe(403);
    const created = await createAccount(await stepUp());
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      name: "Local",
      kind: "openai-chat",
      status: "ok",
      credential: { hint: "sk-…LmWw", backend: "local" },
      models: [
        expect.objectContaining({ upstreamId: "model-a", enabled: true, source: "discovered" }),
      ],
    });
    // The key is an app vault item for the endpoint's host, invisible to bots.
    const [item] = await db.select().from(vaultItems);
    expect(item).toMatchObject({ audience: "app", kind: "api_key" });
    expect(JSON.parse(item!.hostsJson)).toEqual([new URL(endpoint).host]);
    await assertNoSentinel();
  });

  it("puts a new account's models in the picker at once, without a restart", async () => {
    await createAccount(await stepUp());
    const listedModels = (await call("/models")).body.data.models as Data[];
    expect(listedModels.map((m) => m.name)).toContain("model-a");
    expect(listedModels.find((m) => m.name === "model-a")).toMatchObject({
      providerName: "Local",
      available: true,
    });
  });

  it("refuses a private endpoint unless the account opts in, and an http one for a public host", async () => {
    const privateOne = await call("/models/discover", {
      method: "POST",
      json: { ...connection, baseUrl: endpoint, allowPrivateNetwork: false },
    });
    expect(privateOne.status).toBe(400);
    expect(seen).toEqual([]);
    const plainHttp = await call("/models/discover", {
      method: "POST",
      json: { ...connection, baseUrl: "http://example.com/v1", allowPrivateNetwork: false },
    });
    expect(plainHttp.status).toBe(400);
    expect(plainHttp.body.error?.message).toMatch(/https/);
  });

  it("never follows a redirect", async () => {
    const response = await call("/models/discover", {
      method: "POST",
      json: { ...connection, baseUrl: endpoint.replace("/v1", "/redirect") },
    });
    expect(response.status).toBe(400);
    expect(response.body.error?.message).toMatch(/redirect/);
  });

  it("says when the endpoint refuses the key, and refuses a Claude.ai token outright", async () => {
    const rejected = await call("/models/discover", {
      method: "POST",
      json: { ...connection, baseUrl: endpoint, apiKey: "sk-wrong" },
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error?.code).toBe("key_rejected");
    const oauth = await call("/models/discover", {
      method: "POST",
      json: { ...connection, baseUrl: endpoint, apiKey: "sk-ant-oat01-abc" },
    });
    expect(oauth.status).toBe(400);
    expect(seen.some((s) => s.auth?.includes("sk-ant-oat"))).toBe(false);
  });

  it("renames and disables with If-Match, and 412s a stale version", async () => {
    const created = (await createAccount(await stepUp())).body.data;
    const renamed = await call(`/models/providers/${created.id}`, {
      method: "PATCH",
      headers: { "If-Match": String(created.version) },
      json: { name: "Local · Work", enabled: false },
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data).toMatchObject({ name: "Local · Work", enabled: false });
    const stale = await call(`/models/providers/${created.id}`, {
      method: "PATCH",
      headers: { "If-Match": String(created.version) },
      json: { name: "Again" },
    });
    expect(stale.status).toBe(412);
    // A disabled account's models stay listed, greyed out with the reason.
    const model = ((await call("/models")).body.data.models as Data[]).find(
      (m) => m.name === "model-a",
    );
    expect(model).toMatchObject({ available: false, unavailableReason: "disabled" });
  });

  it("marks a model the endpoint stopped listing, keeping its row", async () => {
    const created = (await createAccount(await stepUp())).body.data;
    listed = ["model-b"];
    const refreshed = await call(`/models/providers/${created.id}/refresh`, { method: "POST" });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.account.models[0]).toMatchObject({
      upstreamId: "model-a",
      missing: true,
    });
    expect(refreshed.body.data.available.map((m: Data) => m.upstreamId)).toEqual(["model-b"]);
  });

  it("suggests the models the endpoint lists that the account lacks, without touching its status", async () => {
    const created = (await createAccount(await stepUp())).body.data;
    listed = ["model-a", "model-b", "model-c"];
    const available = await call(`/models/providers/${created.id}/available`);
    expect(available.status).toBe(200);
    expect(available.body.data.models.map((m: Data) => m.upstreamId)).toEqual([
      "model-b",
      "model-c",
    ]);
    const account = ((await call("/models/providers")).body.data.accounts as Data[]).find(
      (a) => a.id === created.id,
    );
    expect(account?.checkedAt).toBe(created.checkedAt);
    // The faux account has nothing to discover.
    const faux = ((await call("/models/providers")).body.data.accounts as Data[]).find(
      (a) => a.kind === "faux",
    );
    if (faux) {
      expect((await call(`/models/providers/${faux.id}/available`)).body.data.models).toEqual([]);
    }
  });

  it("refuses to delete a model or account in use until its bots move", async () => {
    const token1 = await stepUp();
    const created = (await createAccount(token1)).body.data;
    const modelId = created.models[0].id as string;
    await db.insert(bots).values({ name: "Uses it", modelId, conversationId: "77001" });
    await call("/models/roles", { method: "PUT", json: { chat_title: modelId } });

    const refused = await call(`/models/providers/${created.id}`, {
      method: "DELETE",
      stepUp: token1,
    });
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.body)).toContain("Uses it");
    expect((await call(`/models/${modelId}`, { method: "DELETE" })).status).toBe(409);

    const moved = await call(`/models/providers/${created.id}?moveTo=test-model`, {
      method: "DELETE",
      stepUp: token1,
    });
    expect(moved.status).toBe(200);
    expect((await db.select().from(bots))[0]?.modelId).toBe("test-model");
    expect((await db.select().from(modelRoles))[0]?.modelId).toBe("test-model");
    // The account's key went with it.
    expect(await db.$count(vaultItems)).toBe(0);
  });

  it("asks for a new key when the endpoint's host changes", async () => {
    const token1 = await stepUp();
    const created = (await createAccount(token1)).body.data;
    const moved = await call(`/models/providers/${created.id}/connection`, {
      method: "PUT",
      stepUp: token1,
      json: { baseUrl: endpoint.replace("127.0.0.1", "localhost") },
    });
    expect(moved.status).toBe(400);
    expect(moved.body.error?.message).toMatch(/new endpoint/);
  });

  it("sets roles and reports which are fallbacks; a classifier role needs a classifier", async () => {
    const created = (await createAccount(await stepUp())).body.data;
    const modelId = created.models[0].id as string;
    const set = await call("/models/roles", { method: "PUT", json: { chat_title: modelId } });
    expect(set.status).toBe(200);
    expect(set.body.data.roles.chat_title).toEqual({ modelId, fallback: false });
    expect(set.body.data.roles.vision.fallback).toBe(true);
    const wrong = await call("/models/roles", { method: "PUT", json: { classifier: modelId } });
    expect(wrong.status).toBe(400);
    const reset = await call("/models/roles", { method: "PUT", json: { chat_title: null } });
    expect(reset.body.data.roles.chat_title.fallback).toBe(true);
  });

  it("adds, edits and deletes a model by hand", async () => {
    const created = (await createAccount(await stepUp())).body.data;
    const added = await call(`/models/providers/${created.id}/models`, {
      method: "POST",
      json: { upstreamId: "custom-x", name: "Custom X", overrides: { contextWindow: 32_000 } },
    });
    expect(added.status).toBe(201);
    expect(added.body.data).toMatchObject({
      name: "Custom X",
      contextWindow: 32_000,
      source: "manual",
    });
    const edited = await call(`/models/${added.body.data.id}`, {
      method: "PATCH",
      json: { enabled: false, overrides: { imageInput: true } },
    });
    expect(edited.body.data).toMatchObject({ enabled: false, imageInput: true });
    expect((await call(`/models/${added.body.data.id}`, { method: "DELETE" })).status).toBe(200);
  });

  it("rejects unknown fields", async () => {
    const response = await call("/models/discover", {
      method: "POST",
      json: { ...connection, baseUrl: endpoint, extra: true },
    });
    expect(response.status).toBe(400);
  });
});
