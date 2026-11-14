/**
 * Vault building blocks (issue #56): RFC 6238 codes, the redactor, values
 * that can't be serialized by accident and the one "target moved" error.
 */
import { inspect } from "node:util";
import { describe, expect, it } from "vite-plus/test";
import { SecretRedactor } from "../../../../packages/agent/src/redact";
import { SecretValue, VaultTargetMovedError } from "../../../../packages/agent/src/vault";
import { OriginMismatchError } from "../../../../packages/agent/src/toolkits/browser-fill";
import { WindowMismatchError } from "../../../../packages/agent/src/toolkits/computer-sessions";
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
