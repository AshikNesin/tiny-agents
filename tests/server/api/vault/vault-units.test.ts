import { inspect } from "node:util";
import { describe, expect, it } from "vite-plus/test";
import { SecretRedactor } from "../../../../packages/agent/src/redact";
import { SecretValue, VaultTargetMovedError } from "../../../../packages/agent/src/vault";
import { OriginMismatchError } from "../../../../packages/sandbox/src/browser-fill";
import { WindowMismatchError } from "../../../../packages/sandbox/src/computer-sessions";
import { AutofillBehavior, ItemCategory, ItemFieldType } from "@1password/sdk";
import {
  applyDraft,
  fieldValue,
  normalizeExpiry,
  summarize,
  toCreateParams,
} from "../../../../apps/web/src/server/api/vault/backends/onepassword-mapping";
import { opItem } from "./fake-onepassword";
import { parseTotp, totpCode } from "../../../../apps/web/src/server/api/vault/vault.totp";

describe("TOTP", () => {
  const seed = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  const spec = { ...parseTotp(seed)!, digits: 8 };

  it.each([
    [59, "94287082"],
    [1111111109, "07081804"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
  ])("t=%i → %s", (seconds, code) => {
    expect(totpCode(spec, seconds * 1000)).toBe(code);
  });

  it("reads otpauth URIs with their parameters", () => {
    const parsed = parseTotp(
      `otpauth://totp/GitHub:ana?secret=${seed}&issuer=GitHub&digits=8&period=30&algorithm=SHA1`,
    )!;
    expect(parsed.digits).toBe(8);
    expect(totpCode(parsed, 59_000)).toBe("94287082");
    expect(parseTotp("otpauth://hotp/x?secret=ABC")).toBeUndefined();
    expect(parseTotp("not base32 !")).toBeUndefined();
  });
});

describe("SecretValue", () => {
  it("never serializes or logs its value", () => {
    const value = new SecretValue("canary-hunter2");
    expect(JSON.stringify({ value })).toBe('{"value":"[vault]"}');
    expect(String(value)).toBe("[vault]");
    expect(`${value}`).toBe("[vault]");
    expect(inspect({ value })).not.toContain("canary");
    expect(value.reveal()).toBe("canary-hunter2");
  });
});

describe("VaultTargetMovedError", () => {
  it("is the one type every sink's moved target throws", () => {
    const page = new OriginMismatchError("https://evil.example");
    const window = new WindowMismatchError("firefox — Phish");
    for (const error of [page, window]) expect(error).toBeInstanceOf(VaultTargetMovedError);
    expect(page).toMatchObject({
      actual: "https://evil.example",
      reason: "page origin changed before the fill",
    });
    expect(window).toMatchObject({
      actual: "firefox — Phish",
      reason: "active window changed before typing",
      message: "The active window is firefox — Phish, not the one this secret is bound to.",
    });
  });
});

describe("SecretRedactor", () => {
  it("scrubs a value and its encodings", () => {
    const redactor = new SecretRedactor();
    const secret = "canary/sk+live=42";
    redactor.register(secret);
    const encodings = [
      secret,
      Buffer.from(secret).toString("base64"),
      Buffer.from(secret).toString("base64url"),
      encodeURIComponent(secret),
      JSON.stringify(secret).slice(1, -1),
    ];
    for (const form of encodings) {
      expect(redactor.scrub(`before ${form} after`)).toBe("before [vault] after");
    }
    expect(redactor.scrubJson({ a: [`x${secret}`], b: 1 })).toEqual({ a: ["x[vault]"], b: 1 });
  });

  it("scrubs card numbers with or without separators", () => {
    const redactor = new SecretRedactor();
    redactor.register("4242424242424242");
    expect(redactor.scrub("card 4242 4242 4242 4242 ok")).toBe("card [vault] ok");
    expect(redactor.scrub("card 4242-4242-4242-4242")).toBe("card [vault]");
  });

  it("ignores values too short to scrub safely", () => {
    const redactor = new SecretRedactor();
    redactor.register("123");
    expect(redactor.size).toBe(0);
    expect(redactor.scrub("order 123")).toBe("order 123");
  });
});

describe("1Password mapping", () => {
  const login = opItem({
    id: "item1",
    title: "GitHub",
    vaultId: "v1",
    websites: [
      {
        url: "https://github.com/login",
        label: "website",
        autofillBehavior: AutofillBehavior.AnywhereOnWebsite,
      },
    ],
    notes: "shared with the team",
    fields: [
      { id: "username", title: "username", value: "ana" },
      { id: "password", title: "password", fieldType: ItemFieldType.Concealed, value: "pw" },
      {
        id: "x1",
        title: "one-time password",
        fieldType: ItemFieldType.Totp,
        value: "otpauth://totp/x?secret=GEZDGNBV",
      },
      { id: "extra", title: "recovery email", value: "keep me" },
    ],
  });
  const card = opItem({
    id: "item2",
    title: "Amex",
    category: ItemCategory.CreditCard,
    vaultId: "v1",
    fields: [
      { id: "cardholder", title: "cardholder name", value: "Ana Lima" },
      { id: "type", title: "type", fieldType: ItemFieldType.CreditCardType, value: "amex" },
      {
        id: "ccnum",
        title: "number",
        fieldType: ItemFieldType.CreditCardNumber,
        value: "378282246310005",
      },
      {
        id: "cvv",
        title: "verification number",
        fieldType: ItemFieldType.Concealed,
        value: "1234",
      },
      { id: "expiry", title: "expiry date", fieldType: ItemFieldType.MonthYear, value: "12/2030" },
    ],
  });

  it("summarizes without values", () => {
    const summary = summarize(login);
    expect(summary).toMatchObject({
      kind: "login",
      username: "ana",
      hasTotp: true,
      urls: ["https://github.com/login"],
      fields: ["username", "password", "totp", "notes"],
    });
    expect(JSON.stringify(summary)).not.toContain('"pw"');
    const cardSummary = summarize(card);
    expect(cardSummary.card).toEqual({ brand: "Amex", last4: "0005", expiry: "12/2030" });
    expect(JSON.stringify(cardSummary)).not.toContain("378282246310005");
    expect(JSON.stringify(cardSummary)).not.toContain("1234");
  });

  it("finds card fields by template id", () => {
    expect(fieldValue(card, "card_number")).toBe("378282246310005");
    expect(fieldValue(card, "card_cvc")).toBe("1234");
    expect(fieldValue(card, "card_holder")).toBe("Ana Lima");
  });

  it("reads notes from the item and an address from its parts", () => {
    const person = opItem({
      id: "item3",
      title: "Me",
      category: ItemCategory.Identity,
      fields: [
        {
          id: "address",
          title: "address",
          fieldType: ItemFieldType.Address,
          details: {
            type: "Address",
            content: {
              street: "1 Main St",
              city: "Springfield",
              state: "IL",
              zip: "62701",
              country: "us",
            },
          },
        },
      ],
    });
    expect(fieldValue(login, "notes")).toBe("shared with the team");
    expect(fieldValue(person, "identity_address")).toBe("1 Main St, Springfield, IL 62701, us");
  });

  it("normalizes expiry to MM/YYYY", () => {
    expect(normalizeExpiry("203012")).toBe("12/2030");
    expect(normalizeExpiry("3/31")).toBe("03/2031");
    expect(normalizeExpiry("12/2030")).toBe("12/2030");
  });

  it("builds new items pinned to the vault", () => {
    const item = toCreateParams(
      {
        kind: "login",
        title: "Umami",
        urls: ["https://hi.nesin.io"],
        values: { username: "a", password: "b", notes: "n" },
      },
      "v1",
    );
    expect(item).toMatchObject({
      category: ItemCategory.Login,
      vaultId: "v1",
      title: "Umami",
      notes: "n",
      websites: [{ url: "https://hi.nesin.io" }],
    });
    expect(item.fields?.map((f) => [f.id, f.fieldType])).toEqual([
      ["username", ItemFieldType.Text],
      ["password", ItemFieldType.Concealed],
    ]);
  });

  it("keeps fields it doesn't model when applying an edit", () => {
    const next = applyDraft(login, { values: { password: "new", notes: "changed" } });
    expect(fieldValue(next, "password")).toBe("new");
    expect(next.notes).toBe("changed");
    expect(next.fields.find((f) => f.id === "extra")?.value).toBe("keep me");
    expect(fieldValue(login, "password")).toBe("pw");
  });
});
