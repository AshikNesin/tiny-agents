/**
 * Vault building blocks (issue #56): RFC 6238 codes, the redactor, values
 * that can't be serialized by accident, and the 1Password field mapping.
 */
import { inspect } from "node:util";
import { describe, expect, it } from "vite-plus/test";
import { SecretRedactor } from "../../../../packages/agent/src/redact";
import { SecretValue } from "../../../../packages/agent/src/vault";
import {
  applyDraft,
  expiryFromConnect,
  expiryToConnect,
  findField,
  summarize,
  toConnectItem,
  type ConnectItem,
} from "../../../../apps/web/src/server/api/vault/backends/onepassword-mapping";
import { parseTotp, totpCode } from "../../../../apps/web/src/server/api/vault/vault.totp";

describe("TOTP", () => {
  // RFC 6238 appendix B: the SHA1 seed "12345678901234567890", 8 digits.
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
  const login: ConnectItem = {
    id: "item1",
    title: "GitHub",
    category: "LOGIN",
    vault: { id: "v1" },
    urls: [{ href: "https://github.com/login", primary: true }],
    fields: [
      { id: "username", type: "STRING", purpose: "USERNAME", label: "username", value: "ana" },
      { id: "password", type: "CONCEALED", purpose: "PASSWORD", label: "password", value: "pw" },
      {
        id: "x1",
        type: "OTP",
        label: "one-time password",
        value: "otpauth://totp/x?secret=GEZDGNBV",
      },
      { id: "extra", type: "STRING", label: "recovery email", value: "keep me" },
    ],
  };
  const card: ConnectItem = {
    id: "item2",
    title: "Amex",
    category: "CREDIT_CARD",
    vault: { id: "v1" },
    fields: [
      { id: "cardholder", type: "STRING", label: "cardholder name", value: "Ana Lima" },
      { id: "type", type: "CREDIT_CARD_TYPE", label: "type", value: "amex" },
      { id: "ccnum", type: "CREDIT_CARD_NUMBER", label: "number", value: "378282246310005" },
      { id: "cvv", type: "CONCEALED", label: "verification number", value: "1234" },
      { id: "expiry", type: "MONTH_YEAR", label: "expiry date", value: "203012" },
    ],
  };

  it("summarizes without values", () => {
    const summary = summarize(login);
    expect(summary).toMatchObject({
      kind: "login",
      username: "ana",
      hasTotp: true,
      urls: ["https://github.com/login"],
    });
    expect(JSON.stringify(summary)).not.toContain('"pw"');
    const cardSummary = summarize(card);
    expect(cardSummary.card).toEqual({ brand: "Amex", last4: "0005", expiry: "12/2030" });
    expect(JSON.stringify(cardSummary)).not.toContain("378282246310005");
    expect(JSON.stringify(cardSummary)).not.toContain("1234");
  });

  it("finds card fields by template id", () => {
    expect(findField(card, "card_number")?.value).toBe("378282246310005");
    expect(findField(card, "card_cvc")?.value).toBe("1234");
    expect(findField(card, "card_holder")?.value).toBe("Ana Lima");
  });

  it("round-trips expiry between MM/YYYY and YYYYMM", () => {
    expect(expiryFromConnect("203012")).toBe("12/2030");
    expect(expiryFromConnect("3/31")).toBe("03/2031");
    expect(expiryToConnect("12/2030")).toBe("203012");
  });

  it("builds new items pinned to the vault", () => {
    const item = toConnectItem(
      {
        kind: "login",
        title: "Umami",
        urls: ["https://hi.nesin.io"],
        values: { username: "a", password: "b" },
      },
      "v1",
    );
    expect(item).toMatchObject({ category: "LOGIN", vault: { id: "v1" }, title: "Umami" });
    expect(item.fields?.map((f) => f.purpose)).toEqual(["USERNAME", "PASSWORD"]);
  });

  it("keeps fields it doesn't model when applying an edit", () => {
    const next = applyDraft(login, { values: { password: "new" } });
    expect(findField(next, "password")?.value).toBe("new");
    expect(next.fields?.find((f) => f.id === "extra")?.value).toBe("keep me");
  });
});
