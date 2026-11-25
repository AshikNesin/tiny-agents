import { pbkdf2Sync, randomBytes } from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import { config } from "@groot/core/config";
import { dummyHash } from "@groot/core/auth/auth.service";
import { hashPassword, needsRehash, verifyPassword } from "@groot/core/utils/password.utils";
import { setAppConfig } from "../helpers";

function hashAt(password: string, iterations: number): string {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  return [
    "pbkdf2-sha256",
    String(iterations),
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join("$");
}

describe("password hashing", () => {
  it("round-trips and rejects wrong passwords", async () => {
    const hash = await hashPassword("s3cret!");
    expect(hash.startsWith(`pbkdf2-sha256$${config.auth.passwordIterations}$`)).toBe(true);
    expect(await verifyPassword("s3cret!", hash)).toBe(true);
    expect(await verifyPassword("S3cret!", hash)).toBe(false);
  });

  it("hashes with the iteration count the app configures", async () => {
    const before = await hashPassword("x");
    setAppConfig({ auth: { passwordIterations: 1_000 } });
    try {
      const lowered = await hashPassword("x");
      expect(lowered.startsWith("pbkdf2-sha256$1000$")).toBe(true);
      expect(needsRehash(lowered)).toBe(false);

      expect(await verifyPassword("x", before)).toBe(true);
      expect(needsRehash(before)).toBe(true);
    } finally {
      setAppConfig();
    }
    expect(needsRehash(before)).toBe(false);
    expect(needsRehash(await hashPassword("x"))).toBe(false);
  });

  it("checks an unknown email against a dummy hash at the configured count", () => {
    try {
      for (const passwordIterations of [10_000, 100_000, 600_000]) {
        setAppConfig({ auth: { passwordIterations } });
        const [, iterations] = dummyHash().split("$");
        expect(Number(iterations)).toBe(passwordIterations);

        expect(needsRehash(dummyHash())).toBe(false);
      }
    } finally {
      setAppConfig();
    }
  });

  it("uses a fresh salt per hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("rejects malformed stored hashes instead of throwing", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "$2a$10$notbcryptanymore")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2-sha256$100000$abc")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2-sha256$0$c2FsdA$aGFzaA")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2-sha256$NaN$c2FsdA$aGFzaA")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2-sha256$100000$%%%$***")).toBe(false);
  });

  it("flags hashes with a different iteration count", async () => {
    expect(needsRehash(await hashPassword("x"))).toBe(false);
    expect(needsRehash("pbkdf2-sha256$1000$AAAA$BBBB")).toBe(true);
  });

  it("flags the previous 100,000-iteration format for rehashing but still verifies it", async () => {
    const old = hashAt("legacy-count", 100_000);
    expect(await verifyPassword("legacy-count", old)).toBe(true);
    expect(await verifyPassword("nope", old)).toBe(false);
    expect(needsRehash(old)).toBe(true);
    expect(needsRehash(await hashPassword("legacy-count"))).toBe(false);
  });

  it("keeps the unknown-email dummy hash at the current work factor, so timing reveals no account", async () => {
    const [, iterations] = dummyHash().split("$");
    expect(Number(iterations)).toBe(Number((await hashPassword("x")).split("$")[1]));
  });
});
