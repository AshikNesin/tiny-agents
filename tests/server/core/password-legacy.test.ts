import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { db, users } from "@groot/core/database";
import * as authService from "@groot/core/auth/auth.service";
import { needsRehash, verifyPassword } from "@groot/core/utils/password.utils";

const email = "legacy@example.com";
const password = "correct horse battery staple";

async function storedHash(): Promise<string> {
  const [row] = await db.select().from(users).where(eq(users.email, email));
  return row!.password;
}

describe("legacy bcrypt passwords", () => {
  beforeEach(async () => {
    await db.delete(users);
    await db.insert(users).values({ email, password: await bcrypt.hash(password, 4), name: "L" });
  });

  it("verifies a bcrypt hash and reports it for rehashing", async () => {
    const hash = await storedHash();
    expect(await verifyPassword(password, hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
    expect(needsRehash(hash)).toBe(true);
  });

  it("signs in with the old hash and upgrades it to PBKDF2", async () => {
    const result = await authService.login({ email, password });
    expect(result.user.email).toBe(email);

    const upgraded = await storedHash();
    expect(upgraded.startsWith("pbkdf2-sha256$")).toBe(true);
    expect(needsRehash(upgraded)).toBe(false);

    await expect(authService.login({ email, password })).resolves.toBeDefined();
    expect(await storedHash()).toBe(upgraded);
  });

  it("rejects a wrong password without touching the hash", async () => {
    const before = await storedHash();
    await expect(authService.login({ email, password: "nope" })).rejects.toThrow(
      /Invalid email or password/,
    );
    expect(await storedHash()).toBe(before);
  });
});
