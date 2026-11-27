import { AutofillBehavior, ItemCategory, ItemFieldType } from "@1password/sdk";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createOnePasswordBackend } from "../../../../apps/web/src/server/api/vault/backends/onepassword";
import { createFakeOnePassword, opItem, type FakeOnePassword } from "./fake-onepassword";

let op: FakeOnePassword;

beforeEach(() => {
  op = createFakeOnePassword();
  op.tokens.set("read-token", { vaults: ["vault-agents"], write: false });
  op.tokens.set("admin-token", { vaults: ["vault-agents"], write: true });
  op.tokens.set("wide-token", { vaults: ["vault-agents", "vault-other"], write: false });
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
          value: "canary-gh-pw",
        },
        {
          id: "onetimepassword",
          title: "one-time password",
          fieldType: ItemFieldType.Totp,
          value: "otpauth://totp/GitHub?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
          details: { type: "Otp", content: { code: "123456" } },
        },
      ],
    }),
  );
});

const backend = (token: string, writable = false) =>
  createOnePasswordBackend({ vaultId: "vault-agents", token, writable, connect: op.connect });

describe("1Password service account backend", () => {
  it("is ready when the token sees exactly the pinned vault", async () => {
    expect(await backend("read-token").status()).toEqual({
      state: "ready",
      detail: 'Vault "tiny-agents".',
    });
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
    expect(op.calls.some((call) => call.op.startsWith("items."))).toBe(false);
  });

  it("reports a token 1Password rejects as unauthorized", async () => {
    expect(await backend("revoked").status()).toMatchObject({
      state: "error",
      code: "unauthorized",
    });
  });

  it("reports a failed request as unreachable and recovers on the next check", async () => {
    const read = backend("read-token");
    op.unavailable.calls = 1;
    expect(await read.status()).toEqual({
      state: "error",
      code: "unreachable",
      detail:
        "1Password is unreachable: its SDK couldn't send the request from this server (network, DNS, firewall or TLS).",
    });
    expect(await read.status()).toMatchObject({ state: "ready" });
  });

  it("gives up on a call that never answers", async () => {
    const stuck = createOnePasswordBackend({
      token: "read-token",
      writable: false,
      timeoutMs: 20,
      connect: () => new Promise(() => {}),
    });
    expect(await stuck.status()).toEqual({
      state: "error",
      code: "unreachable",
      detail: "1Password did not answer in time.",
    });
  });

  it("resolves one field and uses the code 1Password computed for TOTP", async () => {
    const read = backend("read-token");
    expect((await read.resolve("gh", "password")).reveal()).toBe("canary-gh-pw");
    expect((await read.resolve("gh", "totp")).reveal()).toBe("123456");
    await expect(read.resolve("gh", "card_number")).rejects.toMatchObject({
      code: "missing_field",
    });
    expect(op.calls.every((call) => !call.vaultId || call.vaultId === "vault-agents")).toBe(true);
  });

  it("computes TOTP from the seed when 1Password sent no code", async () => {
    const item = op.items.get("gh")!;
    const otp = item.fields.find((f) => f.fieldType === ItemFieldType.Totp)!;
    delete otp.details;
    expect((await backend("read-token").resolve("gh", "totp")).reveal()).toMatch(/^\d{6}$/);
  });

  it("refuses an item outside the pinned vault", async () => {
    op.items.set("fam", opItem({ id: "fam", title: "x", vaultId: "vault-other" }));
    await expect(backend("read-token").resolve("fam", "password")).rejects.toMatchObject({
      code: "not_found",
      message: "Item not found in the pinned vault.",
    });
    await expect(backend("read-token").resolve("missing", "password")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("lists candidates without values", async () => {
    const candidates = await backend("read-token").listCandidates();
    expect(candidates.unreadable).toEqual([]);
    expect(candidates.items).toEqual([
      expect.objectContaining({
        externalId: "gh",
        title: "GitHub",
        kind: "login",
        urls: ["https://github.com/login"],
      }),
    ]);
    expect(JSON.stringify(candidates)).not.toContain("canary");
  });

  it("pins the token's only vault when no vault id is set", async () => {
    const unpinned = createOnePasswordBackend({
      token: "read-token",
      writable: false,
      connect: op.connect,
    });
    expect(await unpinned.status()).toMatchObject({
      state: "ready",
      detail: 'Vault "tiny-agents".',
    });
    expect((await unpinned.resolve("gh", "password")).reveal()).toBe("canary-gh-pw");
  });

  it("refuses a token that sees two vaults when no vault id is set", async () => {
    const unpinned = createOnePasswordBackend({
      token: "wide-token",
      writable: false,
      connect: op.connect,
    });
    expect(await unpinned.status()).toMatchObject({
      state: "error",
      code: "token_overscoped",
      detail: "The token must see exactly one vault; it sees 2.",
    });
    await expect(unpinned.listCandidates()).rejects.toMatchObject({ code: "token_overscoped" });
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
      values: {
        card_number: "3782 822463 10005",
        card_expiry: "12/30",
        card_holder: "Ana",
        notes: "work card",
      },
    });
    const stored = op.items.get(id)!;
    expect(stored.category).toBe(ItemCategory.CreditCard);
    expect(stored.vaultId).toBe("vault-agents");
    expect(stored.notes).toBe("work card");
    expect(stored.fields.find((f) => f.id === "ccnum")).toMatchObject({
      fieldType: ItemFieldType.CreditCardNumber,
      value: "378282246310005",
    });
    expect(stored.fields.find((f) => f.id === "expiry")).toMatchObject({
      fieldType: ItemFieldType.MonthYear,
      value: "12/2030",
    });
    expect(await admin.describe(id)).toMatchObject({
      card: { brand: "Amex", last4: "0005", expiry: "12/2030" },
      fields: ["card_holder", "card_number", "card_expiry", "notes"],
    });
    expect(op.calls.filter((call) => call.op === "items.get")).toHaveLength(1);

    await admin.update!("gh", { values: { password: "rotated" } });
    expect((await backend("read-token").resolve("gh", "password")).reveal()).toBe("rotated");
    expect(
      op.items.get("gh")!.fields.find((f) => f.fieldType === ItemFieldType.Totp),
    ).toBeDefined();

    await admin.remove!(id);
    expect(op.items.has(id)).toBe(false);
  });

  it("saves a new login's one-time password in its own section", async () => {
    const admin = backend("admin-token", true);
    const id = await admin.create!({
      kind: "login",
      title: "Umami",
      urls: ["https://hi.example.com"],
      values: { username: "ana", password: "pw", totp: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" },
    });
    const stored = op.items.get(id)!;
    expect(stored.websites.map((site) => site.url)).toEqual(["https://hi.example.com"]);
    expect(stored.sections).toEqual([{ id: "tiny-agents", title: "tiny-agents" }]);
    expect(stored.fields.find((f) => f.fieldType === ItemFieldType.Totp)).toMatchObject({
      sectionId: "tiny-agents",
      value: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    });
  });

  it("says which step 1Password refused, in its words", async () => {
    op.refuseCreate = "invalid item: field type mismatch";
    await expect(
      backend("admin-token", true).create!({
        kind: "login",
        title: "x",
        values: { password: "p" },
      }),
    ).rejects.toMatchObject({
      code: "failed",
      message: "1Password couldn't save the item: invalid item: field type mismatch.",
    });
  });
});
