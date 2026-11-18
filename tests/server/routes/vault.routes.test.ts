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
import {
  db,
  users,
  vaultAuditEvents,
  vaultItems,
  vaultValues,
} from "../../../apps/web/src/server/db";
import { setReadBackendsForTests } from "../../../apps/web/src/server/api/vault/backends";
import { createLocalBackend } from "../../../apps/web/src/server/api/vault/backends/local";
import {
  createAppCredential,
  createItem,
  deleteItem,
  setWriteBackendsForTests,
  updateItem,
} from "../../../apps/web/src/server/api/vault/vault.admin.service";
import {
  clearStatusCache,
  forgetAppCredential,
  listFor,
  planUse,
  runItemUse,
  resolveConnectionSecret,
  resolveProviderSecret,
} from "../../../apps/web/src/server/api/vault/vault.service";
import { clearStepUpsForTests } from "../../../apps/web/src/server/api/vault/vault.stepup";
import {
  submitRequest,
  cancelRequest,
} from "../../../apps/web/src/server/api/vault/vault.requests.service";
import {
  createBrowserSessions,
  type BrowserSession,
  type BrowserSessions,
} from "../../../packages/agent/src/toolkits/browser";
import { setBrowserSessionsForTests } from "../../../apps/web/src/server/api/bots/browser.sessions";
import { OriginMismatchError, type SecretFill } from "../../../packages/sandbox/src/browser-fill";
import { WindowMismatchError } from "../../../packages/sandbox/src/computer-sessions";
import { secretRedactor } from "../../../packages/agent/src/redact";
import type { CredentialRequest } from "../../../packages/agent/src/credentials";
import { api, createTestApp, type TestApp } from "../helpers";

const CANARY = "canary-pw-7Hq2Zx";
const PASSWORD = "owner-password-123";

/** The local backend's sealed rows, as stored. */
async function dumpValues(): Promise<string> {
  return JSON.stringify(await db.select().from(vaultValues));
}

const app: TestApp = createTestApp();
let token: string;

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
  await db.delete(vaultValues);
  const local = createLocalBackend();
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
  expect(await dumpValues()).not.toContain(CANARY);
}

describe("vault routes", () => {
  it("refuses writes without step-up and a wrong password, without ending the session (#164)", async () => {
    const response = await createGithub("not-a-token");
    expect(response.status).toBe(403);
    const wrong = await vault("/step-up", { method: "POST", json: { password: "nope" } });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error?.code).not.toBe("SESSION_INVALID");
    expect(await db.$count(vaultItems)).toBe(0);
  });

  it("refuses a passkey it does not know without ending the session (#174)", async () => {
    const options = await vault("/step-up/options", { method: "POST" });
    expect(options.status).toBe(200);
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: "webauthn.get",
        challenge: options.body.data.challenge,
        origin: "http://localhost:3000",
      }),
    ).toString("base64url");
    const unknown = await vault("/step-up", {
      method: "POST",
      json: {
        passkey: {
          id: "not-a-registered-credential",
          rawId: "not-a-registered-credential",
          type: "public-key",
          clientExtensionResults: {},
          response: { clientDataJSON, authenticatorData: "", signature: "" },
        },
      },
    });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error?.code).not.toBe("SESSION_INVALID");
    expect(unknown.body.error?.message).toMatch(/Passkey not found/);
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
    expect(await dumpValues()).not.toContain("rotated-canary");
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
    targetKind: "origin" as const,
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

  it.each([
    [new Error("page gone"), "sink_error", "the sink failed: Error"],
    [
      new OriginMismatchError("https://evil.example"),
      "refused_origin",
      "page origin changed before the fill",
    ],
    [
      new WindowMismatchError("firefox — Phish"),
      "refused_origin",
      "active window changed before typing",
    ],
  ])(
    "audits a sink that threw %s as what happened, not as used",
    async (thrown, outcome, reason) => {
      await expect(
        runItemUse(
          { ...use("https://github.com"), approved: true },
          { unattended: false, botName: "Bot" },
          ["password"],
          async () => {
            throw thrown;
          },
        ),
      ).rejects.toBe(thrown);
      const [row] = await db.select().from(vaultItems).where(eq(vaultItems.handle, "github"));
      expect(row?.lastUsedAt).toBeNull();
      const outcomes = (
        await db.select().from(vaultAuditEvents).where(ne(vaultAuditEvents.tool, "vault_ui"))
      ).map((e) => [e.outcome, e.reason]);
      expect(outcomes).toEqual([[outcome, reason]]);
    },
  );

  it("resolves a connection's secret through the same policy, without a bot scope", async () => {
    // An api_key allows mcp by default; scoping it to a bot does not shut
    // the connection out, since the owner linked the item to the connection.
    const response = await vault("/items", {
      method: "POST",
      stepUp: await stepUp(),
      json: {
        kind: "api_key",
        title: "gh-mcp",
        values: { value: CANARY },
        policy: { handle: "gh-mcp", bots: ["some-bot"] },
      },
    });
    expect(response.status).toBe(201);
    expect(await resolveConnectionSecret("gh-mcp", "github")).toBe(CANARY);
    const [row] = await db.select().from(vaultItems).where(eq(vaultItems.handle, "gh-mcp"));
    expect(row?.lastUsedBy).toBe("mcp:github");
    await db.update(vaultItems).set({ disabled: true }).where(eq(vaultItems.handle, "gh-mcp"));
    await expect(resolveConnectionSecret("gh-mcp", "github")).rejects.toThrow(
      'Vault item "gh-mcp": Vault item `gh-mcp` is disabled.',
    );
    await expect(resolveConnectionSecret("nope", "github")).rejects.toThrow(
      'Vault item "nope": No vault item `nope`. Call vault_list.',
    );
    // The same audit as a bot's use, with no bot, conversation or approval behind it.
    const audited = await db
      .select()
      .from(vaultAuditEvents)
      .where(eq(vaultAuditEvents.tool, "mcp"));
    expect(
      audited
        .map((e) => [e.outcome, e.handle, e.target, e.botId, e.conversationId, e.unattended])
        .sort(),
    ).toEqual([
      ["disabled", "gh-mcp", "mcp:github", null, null, false],
      ["unknown_handle", "nope", "mcp:github", null, null, false],
      ["used", "gh-mcp", "mcp:github", null, null, false],
    ]);
    await assertNoCanary();
  });

  it("refuses unknown handles, other tools and unattended runs, and audits each", async () => {
    expect(
      await planUse(use("https://github.com", { handle: "nope" }), { unattended: false }),
    ).toMatchObject({ refused: "unknown_handle" });
    expect(
      await planUse(use("api.github.com", { tool: "http_request", targetKind: "host" }), {
        unattended: false,
      }),
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
      runItemUse(
        { ...use("https://github.com"), approved: false },
        { unattended: false },
        ["password"],
        sink,
      ),
    ).rejects.toMatchObject({ code: "refused_policy" });
    expect(sink).not.toHaveBeenCalled();
    await expect(
      runItemUse(
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

/** A full policy, as the route's schema would default it. */
const policyOf = (policy: { handle: string; hosts?: string[]; tools?: string[] }) => ({
  origins: [],
  hosts: [],
  tools: [],
  bots: null,
  approval: "per_conversation" as const,
  allowUnattended: false,
  disabled: false,
  ...policy,
});

describe("app credentials (audience app)", () => {
  const createKey = () =>
    createAppCredential({
      handle: "provider-anthropic",
      label: "Model provider: Anthropic",
      value: CANARY,
      hosts: ["api.anthropic.com"],
      inject: { as: "header", name: "x-api-key", format: "{value}" },
    });

  beforeEach(() => forgetAppCredential());

  it("resolves for its provider's host only, without a per-use audit row", async () => {
    await createKey();
    const input = { providerName: "Anthropic", host: "api.anthropic.com" };
    expect(await resolveProviderSecret("provider-anthropic", input)).toBe(CANARY);
    await expect(
      resolveProviderSecret("provider-anthropic", {
        providerName: "Anthropic",
        host: "evil.example",
      }),
    ).rejects.toMatchObject({ code: "refused_origin" });
    const outcomes = (
      await db.select().from(vaultAuditEvents).where(eq(vaultAuditEvents.tool, "model"))
    ).map((e) => e.outcome);
    expect(outcomes).toEqual(["refused_origin"]);
    const [row] = await db.select().from(vaultItems);
    // The Vault page says "used … by Anthropic", not the account's id.
    expect(row?.lastUsedBy).toBe("Anthropic");
    await assertNoCanary();
  });

  it("is invisible to bots: not listed, and unknown to their tools", async () => {
    await createKey();
    expect(await listFor({})).toEqual([]);
    expect(
      await planUse(
        {
          handle: "provider-anthropic",
          tool: "http_request",
          targetKind: "host",
          target: "api.anthropic.com",
          conversation: 1,
          granted: false,
        },
        { unattended: false },
      ),
    ).toMatchObject({ refused: "unknown_handle" });
  });

  it("a bot item can't be used as a provider key", async () => {
    await createItem({
      kind: "api_key",
      title: "k",
      urls: [],
      values: { value: CANARY },
      policy: policyOf({ handle: "bot-key", hosts: ["api.anthropic.com"], tools: ["model"] }),
    });
    await expect(
      resolveProviderSecret("bot-key", { providerName: "Anthropic", host: "api.anthropic.com" }),
    ).rejects.toMatchObject({ code: "refused_origin" });
  });

  it("stops opening when its hosts are widened in the database", async () => {
    await createKey();
    await db
      .update(vaultItems)
      .set({ hostsJson: JSON.stringify(["api.anthropic.com", "evil.example"]) })
      .where(eq(vaultItems.handle, "provider-anthropic"));
    await expect(
      resolveProviderSecret("provider-anthropic", {
        providerName: "Anthropic",
        host: "evil.example",
      }),
    ).rejects.toMatchObject({ code: "backend_error" });
  });

  it("can't be edited or deleted from the Vault page", async () => {
    await createKey();
    await expect(
      updateItem("provider-anthropic", {
        policy: policyOf({ handle: "provider-anthropic", hosts: ["evil.example"] }),
      }),
    ).rejects.toMatchObject({ output: { statusCode: 409 } });
    await expect(deleteItem("provider-anthropic", { purge: true })).rejects.toMatchObject({
      output: { statusCode: 409 },
    });
  });
});

describe("policy binding (local backend)", () => {
  it("re-seals on a policy edit through the service, but not on one behind its back", async () => {
    await createItem({
      kind: "api_key",
      title: "k",
      urls: [],
      values: { value: CANARY },
      policy: policyOf({ handle: "k", hosts: ["api.example.com"], tools: ["http_request"] }),
    });
    const use = (target: string) =>
      runItemUse(
        {
          handle: "k",
          tool: "http_request",
          targetKind: "host",
          target,
          conversation: 1,
          granted: false,
          approved: true,
        },
        { unattended: false },
        ["value"],
        async (values) => values.value!.reveal(),
      );
    await updateItem("k", {
      policy: policyOf({
        handle: "k",
        hosts: ["api.example.com", "two.example.com"],
        tools: ["http_request"],
      }),
    });
    expect(await use("two.example.com")).toBe(CANARY);
    await db
      .update(vaultItems)
      .set({ hostsJson: JSON.stringify(["api.example.com", "two.example.com", "evil.example"]) })
      .where(eq(vaultItems.handle, "k"));
    await expect(use("evil.example")).rejects.toMatchObject({ code: "backend_error" });
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
    targetKind: "command" as const,
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
    const keys = await runItemUse(
      {
        handle: "visa",
        tool: "browser_fill_secret",
        targetKind: "origin",
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
  const fills: { origin: string; steps?: boolean; fields: { key: string; value: string }[] }[] = [];
  let origin = "https://hi.nesin.io";
  /** The page navigates here as the fill starts (a redirect racing the submit). */
  let movesTo: string | undefined;

  const session: BrowserSession = {
    url: () => `${origin}/login`,
    origin: async () => origin,
    fillSecret: async (fill: SecretFill) => {
      if (movesTo) origin = movesTo;
      if (fill.origin !== origin) throw new OriginMismatchError(origin);
      fills.push({
        origin: fill.origin,
        ...(fill.steps !== undefined ? { steps: fill.steps } : {}),
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

  let sessions: BrowserSessions;
  beforeEach(async () => {
    fills.length = 0;
    origin = "https://hi.nesin.io";
    movesTo = undefined;
    sessions = createBrowserSessions({ transport: async () => session });
    setBrowserSessionsForTests(sessions);
    await sessions.start(target);
  });

  afterEach(async () => {
    await sessions.closeAll();
    setBrowserSessionsForTests(undefined);
  });

  it("fills the page across sign-in steps, saves a login and tells the bot only the keys", async () => {
    const runtime = fakeRuntime();
    const result = await submitRequest(
      7,
      { values: { email: "ana@example.com", password: CANARY }, save: true },
      runtime as never,
    );
    expect(result).toEqual({
      filled: ["email", "password"],
      savedHandle: "hi-nesin-io",
      saveFailed: false,
    });
    expect(fills).toEqual([
      {
        origin: "https://hi.nesin.io",
        // An email page, then a password page (Amazon's sign-in): the fill moves through both.
        steps: true,
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

  it("refuses when the page moves as the fill starts", async () => {
    movesTo = "https://evil.example";
    const runtime = fakeRuntime();
    await expect(
      submitRequest(
        7,
        { values: { email: "a@b.c", password: CANARY }, save: false },
        runtime as never,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "The page moved before the fill. Nothing was filled.",
    });
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
