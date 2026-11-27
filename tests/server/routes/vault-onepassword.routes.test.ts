import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { generateToken } from "@groot/core/utils/jwt.utils";
import { hashPassword } from "@groot/core/utils/password.utils";
import {
  db,
  users,
  vaultAuditEvents,
  vaultItems,
  vaultValues,
} from "../../../apps/web/src/server/db";
import { AutofillBehavior, ItemFieldType } from "@1password/sdk";
import {
  setOnePasswordConnectorForTests,
  setVaultBackendsForTests,
} from "../../../apps/web/src/server/api/vault/backends";
import { createAppCredential } from "../../../apps/web/src/server/api/vault/vault.admin.service";
import {
  clearStatusCache,
  forgetAppCredential,
  resolveGitHubToken,
  resolveProviderSecret,
  runItemUse,
} from "../../../apps/web/src/server/api/vault/vault.service";
import { clearStepUpsForTests } from "../../../apps/web/src/server/api/vault/vault.stepup";
import { secretRedactor } from "../../../packages/agent/src/redact";
import { createFakeOnePassword, opItem, type FakeOnePassword } from "../api/vault/fake-onepassword";
import { api, createTestApp, type TestApp } from "../helpers";

const PASSWORD = "owner-password-123";

const app: TestApp = createTestApp();
let token: string;
let op: FakeOnePassword;

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
  setVaultBackendsForTests(undefined);
  clearStatusCache();
}

beforeEach(async () => {
  await db.delete(vaultAuditEvents);
  await db.delete(vaultItems);
  await db.delete(vaultValues);
  clearStepUpsForTests();
  op = createFakeOnePassword();
  setOnePasswordConnectorForTests(op.connect);
  op.tokens.set("read-token", { vaults: ["vault-agents"], write: false });
  op.tokens.set("admin-token", { vaults: ["vault-agents"], write: true });
  op.items.set(
    "gh",
    opItem({
      id: "gh",
      title: "GitHub",
      websites: [
        {
          url: "https://github.com/login",
          label: "website",
          autofillBehavior: AutofillBehavior.AnywhereOnWebsite,
        },
      ],
      fields: [
        { id: "username", title: "username", value: "ana" },
        {
          id: "password",
          title: "password",
          fieldType: ItemFieldType.Concealed,
          value: "canary-op-pw",
        },
      ],
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  setOnePasswordConnectorForTests(undefined);
  rebuildBackends();
  secretRedactor.clear();
});

function useServiceAccounts(tokens: { read?: string; admin?: string }): void {
  if (tokens.read) vi.stubEnv("OP_SERVICE_ACCOUNT_TOKEN", tokens.read);
  if (tokens.admin) vi.stubEnv("OP_SERVICE_ACCOUNT_ADMIN_TOKEN", tokens.admin);
  rebuildBackends();
}

// oxlint-disable-next-line typescript/no-explicit-any
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

describe("1Password through service accounts", () => {
  beforeEach(() => {
    useServiceAccounts({ read: "read-token", admin: "admin-token" });
  });

  it("shows the 1Password card and its items to link, with no vault id set", async () => {
    const overview = (await vault("")).body.data;
    expect(overview.backends).toEqual([
      expect.objectContaining({
        name: "onepassword",
        configured: true,
        read: { state: "ready", detail: 'Vault "tiny-agents".' },
        write: { state: "ready", detail: 'Vault "tiny-agents".' },
        capabilities: { create: true, update: true, delete: true, reveal: true },
      }),
      expect.objectContaining({ name: "local" }),
    ]);
    expect(overview.primaryBackend).toBe("onepassword");
    expect(overview.unlinked).toEqual([
      expect.objectContaining({
        backend: "onepassword",
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
      json: { backend: "onepassword", externalId: "gh", policy: { handle: "github" } },
    });
    expect(linked.status).toBe(201);
    expect(linked.body.data).toMatchObject({
      handle: "github",
      backend: "onepassword",
      origins: ["https://github.com"],
    });

    op.calls.length = 0;
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
    expect(op.calls.length).toBeGreaterThan(0);
    expect(op.calls.every((call) => call.token === "read-token")).toBe(true);
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
    expect(created.body.data.backend).toBe("onepassword");
    const row = await db.query.vaultItems.findFirst({ where: eq(vaultItems.handle, "umami") });
    const stored = op.items.get(row!.externalId)!;
    expect(stored).toMatchObject({ title: "Umami", category: "Login", vaultId: "vault-agents" });
    expect(stored.fields.find((f) => f.id === "password")?.value).toBe("canary-new");
    expect(await db.select().from(vaultValues)).toEqual([]);
  });

  it("says which step 1Password refused, in its words", async () => {
    op.refuseCreate = "invalid item: field type mismatch";
    const response = await vault("/items", {
      method: "POST",
      stepUp: await stepUp(),
      json: {
        kind: "login",
        title: "Nowhere",
        urls: [],
        values: { username: "a", password: "b" },
        policy: { handle: "nowhere" },
      },
    });
    expect(response.status).toBe(502);
    expect(JSON.stringify(response.body)).toContain(
      "1Password couldn't save the item: invalid item: field type mismatch.",
    );
  });

  it("keeps new items local with only the read token", async () => {
    vi.unstubAllEnvs();
    useServiceAccounts({ read: "read-token" });
    const overview = (await vault("")).body.data;
    expect(overview.primaryBackend).toBe("local");
    expect(overview.backends[0]).toMatchObject({
      name: "onepassword",
      capabilities: { create: false, update: false, delete: false, reveal: true },
    });
  });
});

describe("moving local items to 1Password", () => {
  it("moves local items with their values, the app's own keys too", async () => {
    rebuildBackends();
    const grant = await stepUp();
    for (const [handle, password] of [
      ["github", "canary-gh"],
      ["umami", "canary-umami"],
    ]) {
      const created = await vault("/items", {
        method: "POST",
        stepUp: grant,
        json: {
          kind: "login",
          title: handle,
          urls: [`https://${handle}.example.com`],
          values: { username: "ana", password, totp: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" },
          policy: { handle },
        },
      });
      expect(created.body.data.backend).toBe("local");
    }
    await createAppCredential({
      handle: "openai",
      label: "OpenAI",
      value: "canary-app-key",
      hosts: ["api.openai.com"],
      inject: { as: "header", name: "Authorization", format: "Bearer {value}" },
    });

    useServiceAccounts({ read: "read-token", admin: "admin-token" });
    expect((await vault("")).body.data.movableToOnePassword).toBe(3);

    const moved = await vault("/move-to-1password", { method: "POST", stepUp: grant, json: {} });
    expect(moved.status).toBe(200);
    expect(moved.body.data).toEqual({ moved: ["openai", "github", "umami"], failed: [] });

    const rows = await db.select().from(vaultItems);
    expect(Object.fromEntries(rows.map((r) => [r.handle, r.backend]))).toEqual({
      github: "onepassword",
      umami: "onepassword",
      openai: "onepassword",
    });
    expect(await db.select().from(vaultValues)).toHaveLength(0);
    expect(
      await resolveProviderSecret("openai", { providerName: "OpenAI", host: "api.openai.com" }),
    ).toBe("canary-app-key");
    const umami = op.items.get(rows.find((r) => r.handle === "umami")!.externalId)!;
    expect(umami).toMatchObject({ title: "umami", category: "Login", vaultId: "vault-agents" });
    expect(umami.fields.find((f) => f.id === "password")?.value).toBe("canary-umami");
    expect(umami.fields.find((f) => f.fieldType === ItemFieldType.Totp)?.value).toBe(
      "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    );

    const filled = await runItemUse(
      {
        handle: "umami",
        tool: "browser_fill_secret",
        targetKind: "origin",
        target: "https://umami.example.com",
        conversation: 1,
        granted: false,
        approved: true,
      },
      { unattended: false },
      ["password"],
      async (values) => values.password!.reveal(),
    );
    expect(filled).toBe("canary-umami");
    expect((await vault("")).body.data.movableToOnePassword).toBe(0);
  });

  it("keeps the app's keys working while 1Password is unreachable", async () => {
    useServiceAccounts({ read: "read-token", admin: "admin-token" });
    forgetAppCredential();
    await createAppCredential({
      handle: "gh-app-webhook",
      label: "Code: GitHub App webhook secret",
      value: "canary-webhook",
      hosts: ["api.github.com", "github.com"],
      inject: { as: "header", name: "Authorization", format: "Bearer {value}" },
      tools: ["github"],
    });
    expect((await db.select().from(vaultItems))[0]!.backend).toBe("onepassword");

    op.unavailable.calls = 2;
    expect(await resolveGitHubToken("gh-app-webhook")).toBe("canary-webhook");

    vi.setSystemTime(new Date(Date.now() + 60 * 60_000));
    op.unavailable.calls = 1000;
    expect(await resolveGitHubToken("gh-app-webhook")).toBe("canary-webhook");
  });

  it("needs the read+write token", async () => {
    useServiceAccounts({ read: "read-token" });
    const response = await vault("/move-to-1password", {
      method: "POST",
      stepUp: await stepUp(),
      json: {},
    });
    expect(response.status).toBe(400);
  });
});
