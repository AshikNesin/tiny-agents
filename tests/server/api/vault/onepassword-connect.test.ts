import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createConnectBackend } from "../../../../apps/web/src/server/api/vault/backends/onepassword-connect";
import { startFakeConnect, type FakeConnect } from "./fake-connect";
import { FIXED_NOW } from "../../../test-clock";

let connect: FakeConnect;

beforeEach(async () => {
  connect = await startFakeConnect();
  connect.tokens.set("read-token", { vaults: ["vault-agents"], write: false });
  connect.tokens.set("admin-token", { vaults: ["vault-agents"], write: true });
  connect.tokens.set("wide-token", { vaults: ["vault-agents", "vault-other"], write: false });
  connect.items.set("gh", {
    id: "gh",
    title: "GitHub",
    category: "LOGIN",
    vault: { id: "vault-agents" },
    urls: [{ href: "https://github.com/login" }],
    fields: [
      { id: "username", purpose: "USERNAME", value: "ana" },
      { id: "password", purpose: "PASSWORD", type: "CONCEALED", value: "canary-gh-pw" },
      {
        id: "otp",
        type: "OTP",
        value: "otpauth://totp/GitHub?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
      },
    ],
  });
});

afterEach(async () => {
  await connect.close();
});

const backend = (token: string, writable = false) =>
  createConnectBackend({ host: connect.url, vaultId: "vault-agents", token, writable });

describe("1Password Connect backend", () => {
  it("is ready when the token sees exactly the pinned vault", async () => {
    expect(await backend("read-token").status()).toMatchObject({ state: "ready" });
  });

  it("refuses a token that can see another vault, naming it", async () => {
    const wide = backend("wide-token");
    expect(await wide.status()).toMatchObject({
      state: "error",
      code: "token_overscoped",
      detail: expect.stringContaining("Family"),
    });
    await expect(wide.resolve("gh", "password")).rejects.toMatchObject({
      code: "token_overscoped",
    });
    expect(connect.requests.some((r) => r.path.includes("/items"))).toBe(false);
  });

  it("reports a revoked token as unauthorized", async () => {
    expect(await backend("revoked").status()).toMatchObject({
      state: "error",
      code: "unauthorized",
    });
  });

  it("resolves one field and computes TOTP from the seed", async () => {
    const read = backend("read-token");
    expect((await read.resolve("gh", "password")).reveal()).toBe("canary-gh-pw");
    expect((await read.resolve("gh", "totp")).reveal()).toMatch(/^\d{6}$/);
    await expect(read.resolve("gh", "card_number")).rejects.toMatchObject({
      code: "missing_field",
    });
    expect(connect.requests.every((r) => r.path.startsWith("/v1/vaults"))).toBe(true);
  });

  it("refuses an item outside the pinned vault", async () => {
    connect.items.set("fam", {
      id: "fam",
      title: "x",
      category: "LOGIN",
      vault: { id: "vault-other" },
    });
    await expect(backend("read-token").resolve("fam", "password")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("lists candidates without values", async () => {
    const candidates = await backend("read-token").listCandidates();
    expect(candidates.unreadable).toEqual([]);
    expect(candidates.items).toEqual([
      expect.objectContaining({ externalId: "gh", title: "GitHub", kind: "login" }),
    ]);
    expect(JSON.stringify(candidates)).not.toContain("canary");
  });

  it("pins the token's only vault when no vault id is set", async () => {
    const unpinned = createConnectBackend({
      host: connect.url,
      token: "read-token",
      writable: false,
    });
    expect(await unpinned.status()).toMatchObject({
      state: "ready",
      detail: 'Vault "tiny-agents".',
    });
    expect((await unpinned.resolve("gh", "password")).reveal()).toBe("canary-gh-pw");
  });

  it("refuses a token that sees two vaults when no vault id is set", async () => {
    const unpinned = createConnectBackend({
      host: connect.url,
      token: "wide-token",
      writable: false,
    });
    expect(await unpinned.status()).toMatchObject({
      state: "error",
      code: "token_overscoped",
      detail: "The token must see exactly one vault; it sees 2.",
    });
    await expect(unpinned.listCandidates()).rejects.toMatchObject({ code: "token_overscoped" });
  });

  it("names a token that expires within two weeks", async () => {
    const exp = Math.floor(Date.parse(FIXED_NOW) / 1000) + 3 * 86_400 + 60;
    const jwt = `x.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.y`;
    connect.tokens.set(jwt, { vaults: ["vault-agents"], write: false });
    expect(await backend(jwt).status()).toMatchObject({
      state: "ready",
      detail: 'Vault "tiny-agents". The token expires in 3 days.',
    });
  });

  it("has no write methods on the read-only token", () => {
    const read = backend("read-token");
    expect(read.create).toBeUndefined();
    expect(read.update).toBeUndefined();
    expect(read.remove).toBeUndefined();
  });

  it("creates, updates and deletes with the read+write token", async () => {
    const admin = backend("admin-token", true);
    const id = await admin.create!({
      kind: "card",
      title: "Amex",
      urls: ["https://shop.example.com"],
      values: { card_number: "3782 822463 10005", card_expiry: "12/2030", card_holder: "Ana" },
    });
    const stored = connect.items.get(id)!;
    expect(stored.category).toBe("CREDIT_CARD");
    expect(stored.vault.id).toBe("vault-agents");
    expect(stored.fields?.find((f) => f.id === "ccnum")?.value).toBe("378282246310005");
    expect(stored.fields?.find((f) => f.id === "expiry")?.value).toBe("203012");
    expect((await admin.describe(id)).card).toEqual({
      brand: "Amex",
      last4: "0005",
      expiry: "12/2030",
    });

    await admin.update!("gh", { values: { password: "rotated" } });
    expect((await backend("read-token").resolve("gh", "password")).reveal()).toBe("rotated");
    expect(connect.items.get("gh")?.fields?.find((f) => f.type === "OTP")).toBeDefined();

    await admin.remove!(id);
    expect(connect.items.has(id)).toBe(false);
  });

  it("keeps only the newest created-item grace entries once the cache is full", async () => {
    const admin = createConnectBackend({
      host: connect.url,
      vaultId: "vault-agents",
      token: "admin-token",
      writable: true,
      createdLimit: 2,
    });
    const first = await admin.create!({
      kind: "login",
      title: "First",
      values: { username: "u", password: "p" },
    });
    const second = await admin.create!({
      kind: "login",
      title: "Second",
      values: { username: "u", password: "p" },
    });
    const third = await admin.create!({
      kind: "login",
      title: "Third",
      values: { username: "u", password: "p" },
    });
    connect.items.delete(first);
    connect.items.delete(second);
    connect.items.delete(third);
    await expect(admin.describe(first)).rejects.toMatchObject({ code: "not_found" });
    await expect(admin.describe(second)).resolves.toMatchObject({ title: "Second" });
    await expect(admin.describe(third)).resolves.toMatchObject({ title: "Third" });
  }, 15_000);
});
