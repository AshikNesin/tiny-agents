import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { generateToken } from "@groot/core/utils/jwt.utils";
import { hashPassword } from "@groot/core/utils/password.utils";
import {
  db,
  users,
  vaultAuditEvents,
  vaultItems,
  vaultValues,
} from "../../../apps/web/src/server/db";
import { installAppForTests } from "../../../apps/web/src/server/app-root";
import { setReadBackendsForTests } from "../../../apps/web/src/server/api/vault/backends";
import { setWriteBackendsForTests } from "../../../apps/web/src/server/api/vault/vault.admin.service";
import { clearStatusCache, runItemUse } from "../../../apps/web/src/server/api/vault/vault.service";
import { clearStepUpsForTests } from "../../../apps/web/src/server/api/vault/vault.stepup";
import { secretRedactor } from "../../../packages/agent/src/redact";
import { startFakeConnect, type FakeConnect } from "../api/vault/fake-connect";
import { api, createTestApp, type TestApp } from "../helpers";

const PASSWORD = "owner-password-123";
const ENV_KEYS = [
  "OP_CONNECT_CREDENTIALS",
  "OP_CONNECT_HOST",
  "OP_CONNECT_VAULT_ID",
  "OP_CONNECT_TOKEN",
  "OP_CONNECT_ADMIN_TOKEN",
] as const;

const app: TestApp = createTestApp();
let token: string;
let connect: FakeConnect;

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({
      email: "op-owner@example.com",
      password: await hashPassword(PASSWORD),
      name: "Owner",
    })
    .returning();
  token = await generateToken({ userId: user!.id, email: user!.email });
});

function rebuildBackends(): void {
  setReadBackendsForTests(undefined);
  setWriteBackendsForTests(undefined);
  clearStatusCache();
}

beforeEach(async () => {
  await db.delete(vaultAuditEvents);
  await db.delete(vaultItems);
  await db.delete(vaultValues);
  clearStepUpsForTests();
  connect = await startFakeConnect();
  connect.tokens.set("read-token", { vaults: ["vault-agents"], write: false });
  connect.tokens.set("admin-token", { vaults: ["vault-agents"], write: true });
  connect.items.set("gh", {
    id: "gh",
    title: "GitHub",
    category: "LOGIN",
    vault: { id: "vault-agents" },
    urls: [{ href: "https://github.com/login" }],
    fields: [
      { id: "username", purpose: "USERNAME", value: "ana" },
      { id: "password", purpose: "PASSWORD", type: "CONCEALED", value: "canary-op-pw" },
    ],
  });
});

afterEach(async () => {
  for (const key of ENV_KEYS) delete process.env[key];
  installAppForTests({ bundledConnect: undefined });
  rebuildBackends();
  secretRedactor.clear();
  await connect.close();
});

// oxlint-disable-next-line typescript/no-explicit-any -- response data varies per route
type Data = any;

function vault(path: string, init: { method?: string; json?: unknown; stepUp?: string } = {}) {
  return api<Data>(app, `/api/v1/vault${path}`, {
    method: init.method ?? "GET",
    token,
    ...(init.json !== undefined ? { json: init.json } : {}),
    ...(init.stepUp ? { headers: { "X-Vault-Step-Up": init.stepUp } } : {}),
  });
}

async function stepUp(): Promise<string> {
  const response = await vault("/step-up", { method: "POST", json: { password: PASSWORD } });
  expect(response.status).toBe(200);
  return response.body.data.token as string;
}

describe("1Password Connect at OP_CONNECT_HOST", () => {
  beforeEach(() => {
    process.env.OP_CONNECT_HOST = connect.url;
    process.env.OP_CONNECT_TOKEN = "read-token";
    process.env.OP_CONNECT_ADMIN_TOKEN = "admin-token";
    rebuildBackends();
  });

  it("shows the 1Password card and its items to link, with no vault id set", async () => {
    const overview = (await vault("")).body.data;
    expect(overview.backends).toEqual([
      expect.objectContaining({
        name: "onepassword-connect",
        configured: true,
        read: { state: "ready", detail: 'Vault "tiny-agents".' },
        write: { state: "ready", detail: 'Vault "tiny-agents".' },
        capabilities: { create: true, update: true, delete: true, reveal: true },
      }),
      expect.objectContaining({ name: "local" }),
    ]);
    expect(overview.primaryBackend).toBe("onepassword-connect");
    expect(overview.unlinked).toEqual([
      expect.objectContaining({
        backend: "onepassword-connect",
        externalId: "gh",
        title: "GitHub",
        kind: "login",
        urls: ["https://github.com/login"],
      }),
    ]);
    expect(JSON.stringify(overview)).not.toContain("canary-op-pw");
  });

  it("links a 1Password item, and a bot's use resolves it with the read-only token", async () => {
    const linked = await vault("/links", {
      method: "POST",
      stepUp: await stepUp(),
      json: { backend: "onepassword-connect", externalId: "gh", policy: { handle: "github" } },
    });
    expect(linked.status).toBe(201);
    expect(linked.body.data).toMatchObject({
      handle: "github",
      backend: "onepassword-connect",
      origins: ["https://github.com"],
    });

    connect.requests.length = 0;
    const filled = await runItemUse(
      {
        handle: "github",
        tool: "browser_fill_secret",
        targetKind: "origin",
        target: "https://github.com",
        conversation: 1,
        granted: false,
        approved: true,
      },
      { unattended: false },
      ["password"],
      async (values) => values.password!.reveal(),
    );
    expect(filled).toBe("canary-op-pw");
    expect(connect.requests.length).toBeGreaterThan(0);
    expect(connect.requests.every((r) => r.token === "read-token")).toBe(true);
  });

  it("creates new items in 1Password, not the local backend", async () => {
    const created = await vault("/items", {
      method: "POST",
      stepUp: await stepUp(),
      json: {
        kind: "login",
        title: "Umami",
        urls: ["https://hi.example.com"],
        values: { username: "a", password: "canary-new" },
        policy: { handle: "umami" },
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.data.backend).toBe("onepassword-connect");
    const row = await db.query.vaultItems.findFirst({ where: eq(vaultItems.handle, "umami") });
    const stored = connect.items.get(row!.externalId)!;
    expect(stored).toMatchObject({
      title: "Umami",
      category: "LOGIN",
      vault: { id: "vault-agents" },
    });
    expect(stored.fields?.find((f) => f.purpose === "PASSWORD")?.value).toBe("canary-new");
    expect(await db.select().from(vaultValues)).toEqual([]);
  });

  it("keeps new items local with only the read token", async () => {
    delete process.env.OP_CONNECT_ADMIN_TOKEN;
    rebuildBackends();
    const overview = (await vault("")).body.data;
    expect(overview.primaryBackend).toBe("local");
    expect(overview.backends[0]).toMatchObject({
      name: "onepassword-connect",
      capabilities: { create: false, update: false, delete: false, reveal: true },
    });
  });
});

describe("the bundled Connect server", () => {
  it("says it is starting while the bundled server comes up", async () => {
    process.env.OP_CONNECT_CREDENTIALS = '{"deviceUuid":"dev-1"}';
    process.env.OP_CONNECT_TOKEN = "read-token";
    rebuildBackends();
    installAppForTests({
      bundledConnect: {
        state: () => ({
          state: "starting",
          detail: "Fetching 1Password Connect 1.8.4 (first start only).",
        }),
        stop: async () => {},
      },
    });

    const [card] = (await vault("")).body.data.backends;
    expect(card).toMatchObject({
      name: "onepassword-connect",
      read: {
        state: "error",
        code: "starting",
        detail: "Fetching 1Password Connect 1.8.4 (first start only).",
      },
    });
  });
});
