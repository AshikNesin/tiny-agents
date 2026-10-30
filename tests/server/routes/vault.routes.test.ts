/**
 * The Vault routes and service end to end (issue #56) on the local backend:
 * step-up before writes and reveals, CRUD, policy decisions, the audit trail,
 * credential request submits, and the canary invariant — no value in the
 * database, in list/detail responses, or in the audit.
 */
import bcrypt from "bcryptjs";
import { asc, eq, ne, sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { generateToken } from "@groot/core/utils/jwt.utils";
import { hashPassword } from "@groot/core/utils/password.utils";
import { db, users, vaultAuditEvents, vaultItems } from "../../../apps/web/src/server/db";
import { setReadBackendsForTests } from "../../../apps/web/src/server/api/vault/backends";
import {
  createLocalBackend,
  type LocalStore,
} from "../../../apps/web/src/server/api/vault/backends/local";
import { setWriteBackendsForTests } from "../../../apps/web/src/server/api/vault/vault.admin.service";
import {
  clearStatusCache,
  planUse,
  useItem,
} from "../../../apps/web/src/server/api/vault/vault.service";
import { clearStepUpsForTests } from "../../../apps/web/src/server/api/vault/vault.stepup";
import {
  submitRequest,
  cancelRequest,
} from "../../../apps/web/src/server/api/vault/vault.requests.service";
import {
  closeBrowserSession,
  createBrowserToolkit,
  startBrowserSession,
  type BrowserSession,
} from "../../../packages/agent/src/toolkits/browser";
import type { SecretFill } from "../../../packages/agent/src/toolkits/browser-fill";
import { secretRedactor } from "../../../packages/agent/src/redact";
import type { CredentialRequest } from "../../../packages/agent/src/credentials";
import { api, createTestApp, type TestApp } from "../helpers";

const CANARY = "canary-pw-7Hq2Zx";
const PASSWORD = "owner-password-123";

function memoryStore(): LocalStore & { dump(): string } {
  const map = new Map<string, string>();
  return {
    get: async (key) => map.get(key),
    set: async (key, value) => void map.set(key, value),
    delete: async (key) => void map.delete(key),
    dump: () => [...map.values()].join("\n"),
  };
}

const app: TestApp = createTestApp();
let token: string;
let store: ReturnType<typeof memoryStore>;

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({
      email: "vault-owner@example.com",
      password: await hashPassword(PASSWORD),
      name: "Owner",
    })
    .returning();
  token = await generateToken({ userId: user!.id, email: user!.email });
});

beforeEach(async () => {
  await db.delete(vaultAuditEvents);
  await db.delete(vaultItems);
  store = memoryStore();
  const local = createLocalBackend(store);
  setReadBackendsForTests(new Map([["local", local]]));
  setWriteBackendsForTests(new Map([["local", local]]));
  clearStatusCache();
  clearStepUpsForTests();
});

afterEach(() => {
  secretRedactor.clear();
});

// oxlint-disable-next-line typescript/no-explicit-any -- response data varies per route
type Data = any;

/** An authenticated vault request; `stepUp` sends the step-up header. */
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

async function createGithub(stepUpToken: string) {
  return vault("/items", {
    method: "POST",
    stepUp: stepUpToken,
    json: {
      kind: "login",
      title: "GitHub",
      urls: ["https://github.com/login"],
      values: { username: "ana", password: CANARY },
      policy: { handle: "github" },
    },
  });
}

/** Everything a value could leak into: rows, audit, the list and detail responses. */
async function assertNoCanary(): Promise<void> {
  const rows = JSON.stringify(await db.select().from(vaultItems));
  const events = JSON.stringify(await db.select().from(vaultAuditEvents));
  const overview = JSON.stringify((await vault("")).body);
  expect(rows).not.toContain(CANARY);
  expect(events).not.toContain(CANARY);
  expect(overview).not.toContain(CANARY);
  // The local backend keeps it encrypted, never in the clear.
  expect(store.dump()).not.toContain(CANARY);
}

describe("vault routes", () => {
  it("refuses writes without step-up and a wrong password", async () => {
    const response = await createGithub("not-a-token");
    expect(response.status).toBe(403);
    const wrong = await vault("/step-up", { method: "POST", json: { password: "nope" } });
    expect(wrong.status).toBe(401);
    expect(await db.$count(vaultItems)).toBe(0);
  });

  it("accepts the password of an account made before groot 3.0 (bcrypt hash)", async () => {
    const [legacy] = await db
      .insert(users)
      .values({
        email: "vault-legacy@example.com",
        password: await bcrypt.hash(PASSWORD, 4),
        name: "Legacy",
      })
      .returning();
    const legacyToken = await generateToken({ userId: legacy!.id, email: legacy!.email });
    const step = (password: string) =>
      api(app, "/api/v1/vault/step-up", {
        method: "POST",
        json: { password },
        token: legacyToken,
      });
    expect((await step(PASSWORD)).status).toBe(200);
    expect((await step("nope")).status).toBe(401);
  });

  it("creates, lists, reveals and deletes with step-up; values never stored in the clear", async () => {
    const grant = await stepUp();
    const created = await createGithub(grant);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      handle: "github",
      kind: "login",
      backend: "local",
      origins: ["https://github.com"],
      username: "ana",
      effectiveApproval: "per_conversation",
    });

    const overview = await vault("");
    expect(overview.headers.get("cache-control")).toBe("no-store");
    expect(overview.headers.get("pragma")).toBe("no-cache");
    expect(overview.body.data.items).toHaveLength(1);

    const detail = await vault("/items/github");
    expect(detail.body.data.fields).toEqual(expect.arrayContaining(["username", "password"]));
    await assertNoCanary();

    const noStepUp = await vault("/items/github/reveal", {
      method: "POST",
      json: { field: "password" },
    });
    expect(noStepUp.status).toBe(403);
    // Errors are no-store too.
    expect(noStepUp.headers.get("cache-control")).toBe("no-store");
    const revealed = await vault("/items/github/reveal", {
      method: "POST",
      stepUp: grant,
      json: { field: "password" },
    });
    expect(revealed.body.data).toEqual({ field: "password", value: CANARY });
    expect(revealed.headers.get("cache-control")).toBe("no-store");
    await assertNoCanary();

    const rotated = await vault("/items/github", {
      method: "PATCH",
      stepUp: grant,
      json: { field: "password", value: "rotated-canary" },
    });
    expect(rotated.status).toBe(200);

    const removed = await vault("/items/github?purge=true", { method: "DELETE", stepUp: grant });
    expect(removed.body.data).toEqual({ deleted: true });
    const outcomes = (
      await db
        .select()
        .from(vaultAuditEvents)
        .orderBy(asc(vaultAuditEvents.at), sql`rowid`)
    ).map((e) => e.outcome);
    expect(outcomes).toEqual(["created", "revealed", "updated", "deleted"]);
    expect(store.dump()).not.toContain("rotated-canary");
  });

  it("keeps cards at every_use and never unattended", async () => {
    const created = await vault("/items", {
      method: "POST",
      stepUp: await stepUp(),
      json: {
        kind: "card",
        title: "Amex",
        urls: ["https://shop.example.com"],
        values: { card_number: "378282246310005", card_expiry: "12/2030", card_cvc: "1234" },
        policy: { handle: "amex", approval: "allowed", allowUnattended: true },
      },
    });
    expect(created.body.data).toMatchObject({
      effectiveApproval: "every_use",
      allowUnattended: false,
      card: { brand: "Amex", last4: "0005", expiry: "12/2030" },
    });
  });
});

describe("vault policy", () => {
  const use = (target: string, overrides: Partial<Parameters<typeof planUse>[0]> = {}) => ({
    handle: "github",
    tool: "browser_fill_secret",
    target,
    conversation: 1,
    granted: false,
    ...overrides,
  });

  beforeEach(async () => {
    expect((await createGithub(await stepUp())).status).toBe(201);
  });

  it("binds logins to their exact origins", async () => {
    expect(await planUse(use("https://github.com"), { unattended: false })).toMatchObject({
      approve: true,
      grantable: true,
    });
    expect(await planUse(use("https://gist.github.com"), { unattended: false })).toMatchObject({
      refused: "refused_origin",
    });
    expect(
      await planUse(use("https://github.com", { granted: true }), { unattended: false }),
    ).toMatchObject({ approve: false });
  });

  it("refuses unknown handles, other tools and unattended runs, and audits each", async () => {
    expect(
      await planUse(use("https://github.com", { handle: "nope" }), { unattended: false }),
    ).toMatchObject({ refused: "unknown_handle" });
    expect(
      await planUse(use("api.github.com", { tool: "http_request" }), { unattended: false }),
    ).toMatchObject({ refused: "refused_policy" });
    expect(await planUse(use("https://github.com"), { unattended: true })).toMatchObject({
      refused: "refused_unattended",
    });
    const outcomes = (
      await db.select().from(vaultAuditEvents).where(ne(vaultAuditEvents.tool, "vault_ui"))
    ).map((e) => e.outcome);
    expect(outcomes.sort()).toEqual(["refused_policy", "refused_unattended", "unknown_handle"]);
  });

  it("resolves into the sink only after approval, registering the value", async () => {
    const sink = vi.fn(async () => "filled");
    await expect(
      useItem(
        { ...use("https://github.com"), approved: false },
        { unattended: false },
        ["password"],
        sink,
      ),
    ).rejects.toMatchObject({ code: "refused_policy" });
    expect(sink).not.toHaveBeenCalled();
    await expect(
      useItem(
        { ...use("https://github.com"), approved: true },
        { unattended: false },
        ["password"],
        sink,
      ),
    ).resolves.toBe("filled");
    const [values] = sink.mock.calls[0] as unknown as [Record<string, { reveal(): string }>];
    expect(values.password.reveal()).toBe(CANARY);
    expect(secretRedactor.scrub(`x ${CANARY} y`)).toBe("x [vault] y");
    await assertNoCanary();
  });
});

describe("sandbox command policy", () => {
  async function createKey(handle: string, policy: Record<string, unknown>) {
    const response = await vault("/items", {
      method: "POST",
      stepUp: await stepUp(),
      json: {
        kind: "api_key",
        title: handle,
        values: { value: CANARY },
        policy: { handle, ...policy },
      },
    });
    expect(response.status).toBe(201);
  }
  const use = (handle: string) => ({
    handle,
    tool: "run_command",
    target: "gh api user",
    conversation: 1,
    granted: true,
  });

  it("needs run_command listed and hosts named, and asks every time", async () => {
    await createKey("gh", {
      tools: ["run_command"],
      hosts: ["api.github.com"],
      approval: "allowed",
    });
    await createKey("gh-default", { hosts: ["api.github.com"] });
    await createKey("gh-nohosts", { tools: ["run_command"] });
    // Even an "allowed" item, already granted for the chat, asks for a command.
    expect(await planUse(use("gh"), { unattended: false })).toMatchObject({
      approve: true,
      grantable: false,
    });
    expect(await planUse(use("gh-default"), { unattended: false })).toMatchObject({
      refused: "refused_policy",
    });
    expect(await planUse(use("gh-nohosts"), { unattended: false })).toMatchObject({
      refused: "refused_origin",
      message: expect.stringMatching(/names no hosts/),
    });
  });
});

describe("card fills", () => {
  it("fill what the card has: a missing security code leaves the number usable", async () => {
    await vault("/items", {
      method: "POST",
      stepUp: await stepUp(),
      json: {
        kind: "card",
        title: "Visa",
        urls: ["https://shop.example.com"],
        values: { card_number: "4242424242424242", card_expiry: "01/2031" },
        policy: { handle: "visa" },
      },
    });
    const sink = vi.fn(async (values: Record<string, { reveal(): string }>) => Object.keys(values));
    const keys = await useItem(
      {
        handle: "visa",
        tool: "browser_fill_secret",
        target: "https://shop.example.com",
        conversation: 1,
        granted: false,
        approved: true,
      },
      { unattended: false },
      ["card_number", "card_expiry", "card_cvc", "card_holder"],
      sink as never,
    );
    expect(keys).toEqual(["card_number", "card_expiry"]);
  });
});

describe("credential request submit", () => {
  const conversation = 4242;
  const target = { profile: "shared", tab: `conversation-${conversation}` };
  const fills: { origin: string; fields: { key: string; value: string }[] }[] = [];
  let origin = "https://hi.nesin.io";

  const session: BrowserSession = {
    url: () => `${origin}/login`,
    origin: async () => origin,
    fillSecret: async (fill: SecretFill) => {
      fills.push({
        origin: fill.origin,
        fields: fill.fields.map((f) => ({ key: f.key, value: f.value.reveal() })),
      });
      return { filled: fill.fields.map((f) => f.key) };
    },
    navigate: async () => ({ url: origin, status: 200 }),
    snapshot: async () => "",
    click: async () => ({ url: origin }),
    type: async () => ({ url: origin }),
    press: async () => {},
    scroll: async () => {},
    screenshot: async () => ({ data: "" }),
    close: async () => {},
  };

  const requestDoc: CredentialRequest = {
    origin: "https://hi.nesin.io",
    title: "Sign in to Umami",
    purpose: "Read the analytics",
    fields: [
      { key: "email", label: "Email", type: "email", required: true, autocomplete: "email" },
      {
        key: "password",
        label: "Password",
        type: "password",
        required: true,
        autocomplete: "current-password",
      },
    ],
  };

  const fakeRuntime = () => ({
    credentialRequest: vi.fn(async () => ({
      conversation,
      request: requestDoc,
      expiresAt: Date.now() + 60_000,
    })),
    settleCredentialRequest: vi.fn(async () => {}),
  });

  beforeEach(async () => {
    fills.length = 0;
    origin = "https://hi.nesin.io";
    createBrowserToolkit({ transport: async () => session });
    await startBrowserSession(target);
  });

  afterEach(async () => {
    await closeBrowserSession(target);
  });

  it("fills the page, saves a login and tells the bot only the keys", async () => {
    const runtime = fakeRuntime();
    const result = await submitRequest(
      7,
      { values: { email: "ana@example.com", password: CANARY }, save: true },
      runtime as never,
    );
    expect(result).toEqual({ filled: ["email", "password"], savedHandle: "hi-nesin-io" });
    expect(fills).toEqual([
      {
        origin: "https://hi.nesin.io",
        fields: [
          { key: "email", value: "ana@example.com" },
          { key: "password", value: CANARY },
        ],
      },
    ]);
    expect(runtime.settleCredentialRequest).toHaveBeenCalledWith(7, {
      status: "filled",
      filled: ["email", "password"],
      savedHandle: "hi-nesin-io",
    });
    expect(JSON.stringify(runtime.settleCredentialRequest.mock.calls)).not.toContain(CANARY);
    const saved = await db.query.vaultItems.findFirst({
      where: eq(vaultItems.handle, "hi-nesin-io"),
    });
    expect(saved).toMatchObject({ kind: "login", username: "ana@example.com" });
    await assertNoCanary();
  });

  it("refuses when the page moved to another origin", async () => {
    origin = "https://evil.example";
    const runtime = fakeRuntime();
    await expect(
      submitRequest(
        7,
        { values: { email: "a@b.c", password: CANARY }, save: false },
        runtime as never,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(fills).toEqual([]);
    expect(runtime.settleCredentialRequest).not.toHaveBeenCalled();
  });

  it("rejects values for fields the request didn't ask for", async () => {
    await expect(
      submitRequest(
        7,
        { values: { email: "a@b.c", password: "x", notes: "hi" }, save: false },
        fakeRuntime() as never,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("cancels", async () => {
    const runtime = fakeRuntime();
    await expect(cancelRequest(7, runtime as never)).resolves.toEqual({ cancelled: true });
    expect(runtime.settleCredentialRequest).toHaveBeenCalledWith(7, { status: "cancelled" });
  });
});
