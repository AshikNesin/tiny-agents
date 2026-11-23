import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { connections, db, vaultValues } from "../../../apps/web/src/server/db";
import {
  hasSecretsKey,
  needsReseal,
  open,
  seal,
  SecretLockedError,
  secretKeyProblem,
  type SecretBinding,
} from "../../../apps/web/src/server/crypto/secret-box";
import {
  openOAuthState,
  resealConnectionSecrets,
  sealOAuthState,
} from "../../../apps/web/src/server/api/connections/connection-secrets";
import {
  createLocalBackend,
  resealLocalItems,
} from "../../../apps/web/src/server/api/vault/backends/local";
import { useFreshTestDatabase } from "../fixtures/test-db";

const KEY = process.env.SECRETS_KEY!;
const VECTOR_KEY = "k4VectorLongKey3W9tZQbGe7Yd2Rm5Tu8Hi1OxPv6Cj4Nf";
const ROTATION_KEY = "Xfrp6IDmk82w_uq-1-nk63YauElKDQ8D3G8h6lzhTZw-";
const binding: SecretBinding = { purpose: "connection", record: "c1", field: "secret_enc" };

afterEach(() => {
  process.env.SECRETS_KEY = KEY;
  delete process.env.SECRETS_KEY_PREVIOUS;
});

function lockReason(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof SecretLockedError) return error.reason;
    throw error;
  }
  return undefined;
}

function bindingFor(
  purpose: SecretBinding["purpose"],
  record: string,
  field: string,
): SecretBinding {
  return { purpose, record, field };
}

describe("SecretBox", () => {
  it("round-trips a value and never stores it in the clear", () => {
    const stored = seal("sk-sentinel", binding);
    expect(stored).toMatch(/^v2:[\w-]+:[\w-]+:[\w-]+:[\w-]+$/);
    expect(stored).not.toContain("sk-sentinel");
    expect(open(stored, binding)).toBe("sk-sentinel");
  });

  it("uses a fresh IV per write", () => {
    expect(seal("x", binding)).not.toBe(seal("x", binding));
  });

  it("derives the same key as before the entropy floor, so stored ciphertexts stay readable", () => {
    process.env.SECRETS_KEY = VECTOR_KEY;
    const vaultLocal = bindingFor("vault-local", "compat-vector", "item");
    const storedBefore =
      "v2:ZbyVAWmX65T:CFYhm1cqddzJZQh1:yYe6moiucXIFNIQeif2l-w:984KLPNXMZHj-mFVilUl7S0";
    expect(open(storedBefore, vaultLocal)).toBe("compat-plain-text");
    expect(seal("compat-plain-text", vaultLocal).split(":")[1]).toBe("ZbyVAWmX65T");
    const connection = bindingFor("connection", "compat-conn", "secret_enc");
    expect(
      open(
        "v2:HawuXqo715-:dBFYvDRzQcgXDRee:Tnh1YeYM20xI9vUfmZB6sA:1vARupz72SBiapBiKjuqmWQ",
        connection,
      ),
    ).toBe("compat-conn-value");
    expect(seal("compat-conn-value", connection).split(":")[1]).toBe("HawuXqo715-");
  });

  it("refuses to seal under a SECRETS_KEY with less than 32 bytes of key material, naming the variable", () => {
    process.env.SECRETS_KEY = "the-old-short-key";
    expect(lockReason(() => seal("x", binding))).toBe("weak_key");
    try {
      seal("x", binding);
      expect.unreachable("seal must refuse a short key");
    } catch (error) {
      expect((error as Error).message).toContain("SECRETS_KEY");
      expect((error as Error).message).toContain("32");
    }
    expect(hasSecretsKey()).toBe(true);
  });

  it("still opens ciphertexts a weaker key sealed, so an operator tightening the key keeps their data", () => {
    const weakKeySealed =
      "v2:E0qcadoQqQo:kgETVQQFAvlP0I0o:I-IpFbv8adBvZFXABTyLBw:Uige3dPl6hsky34wxxonbQE";
    process.env.SECRETS_KEY = "the-old-short-key";
    expect(open(weakKeySealed, bindingFor("vault-local", "compat-vector", "item"))).toBe(
      "compat-plain-text",
    );
  });

  it("counts a hex or base64 key by its decoded bytes, not its characters", () => {
    process.env.SECRETS_KEY = "0f".repeat(31);
    expect(lockReason(() => seal("x", binding))).toBe("weak_key");
    process.env.SECRETS_KEY = "0f".repeat(16);
    expect(lockReason(() => seal("x", binding))).toBe("weak_key");
    process.env.SECRETS_KEY = VECTOR_KEY;
    expect(lockReason(() => seal("x", binding))).toBeUndefined();
  });

  it("names the problem with a short key", () => {
    expect(secretKeyProblem("short")).toContain("SECRETS_KEY");
    expect(secretKeyProblem("short")).toContain("32");
    expect(secretKeyProblem("0f".repeat(32))).toBeUndefined();
    expect(secretKeyProblem(undefined)).toBeUndefined();
  });

  it("refuses a value moved to another record, field, purpose or policy", () => {
    const stored = seal("sk-sentinel", { ...binding, policy: "p1" });
    for (const other of [
      { ...binding, record: "c2", policy: "p1" },
      { ...binding, field: "oauth_enc", policy: "p1" },
      { ...binding, purpose: "vault-local" as const, policy: "p1" },
      { ...binding, policy: "p2" },
    ]) {
      expect(lockReason(() => open(stored, other))).not.toBeUndefined();
    }
  });

  it("refuses the old v1 format", () => {
    expect(lockReason(() => open("v1:aaa:bbb:ccc", binding))).toBe("unreadable");
  });

  it("locks without a key and on a key mismatch", () => {
    const stored = seal("sk-sentinel", binding);
    delete process.env.SECRETS_KEY;
    expect(lockReason(() => open(stored, binding))).toBe("no_key");
    expect(lockReason(() => seal("x", binding))).toBe("no_key");
    process.env.SECRETS_KEY = "another-key";
    expect(lockReason(() => open(stored, binding))).toBe("key_mismatch");
  });

  it("opens values under SECRETS_KEY_PREVIOUS and flags them for rotation", () => {
    const stored = seal("sk-sentinel", binding);
    process.env.SECRETS_KEY = ROTATION_KEY;
    process.env.SECRETS_KEY_PREVIOUS = KEY;
    expect(open(stored, binding)).toBe("sk-sentinel");
    expect(needsReseal(stored, "connection")).toBe(true);
    expect(needsReseal(seal("x", binding), "connection")).toBe(false);
  });
});

describe("secrets:rotate", () => {
  beforeEach(useFreshTestDatabase);

  it("re-seals local vault items and connection secrets under the new key", async () => {
    const backend = createLocalBackend();
    const itemId = await backend.create!({
      kind: "api_key",
      title: "Key",
      values: { value: "v-1" },
    });
    const [row] = await db
      .insert(connections)
      .values({ id: "conn-rotate", name: "C", slug: "c-rotate", url: "https://mcp.example.com" })
      .returning();
    await db
      .update(connections)
      .set({ oauthEnc: sealOAuthState(row!.id, { verifier: "h-1" }) })
      .where(eq(connections.id, row!.id));

    process.env.SECRETS_KEY = ROTATION_KEY;
    process.env.SECRETS_KEY_PREVIOUS = KEY;
    expect(resealLocalItems()).toEqual({ resealed: 1, skipped: [] });
    expect(await resealConnectionSecrets()).toBe(1);
    expect(resealLocalItems()).toEqual({ resealed: 0, skipped: [] });

    delete process.env.SECRETS_KEY_PREVIOUS;
    expect((await backend.resolve(itemId, "value")).reveal()).toBe("v-1");
    const after = await db.query.connections.findFirst({ where: eq(connections.id, row!.id) });
    expect(openOAuthState(row!.id, after!.oauthEnc!)).toEqual({ verifier: "h-1" });
  });

  it("names the items it couldn't re-seal, so SECRETS_KEY_PREVIOUS stays", async () => {
    const backend = createLocalBackend();
    const good = await backend.create!({ kind: "api_key", title: "G", values: { value: "g" } });
    const bad = await backend.create!({ kind: "api_key", title: "B", values: { value: "b" } });
    await db.update(vaultValues).set({ policy: "edited" }).where(eq(vaultValues.id, bad));
    process.env.SECRETS_KEY = ROTATION_KEY;
    process.env.SECRETS_KEY_PREVIOUS = KEY;
    const report = resealLocalItems();
    expect(report.resealed).toBe(1);
    expect(report.skipped).toEqual([bad]);
    delete process.env.SECRETS_KEY_PREVIOUS;
    expect((await backend.resolve(good, "value")).reveal()).toBe("g");
  });

  it("a local item copied under another id doesn't open", async () => {
    const backend = createLocalBackend();
    const a = await backend.create!({ kind: "api_key", title: "A", values: { value: "a" } });
    const b = await backend.create!({ kind: "api_key", title: "B", values: { value: "b" } });
    const copied = await db.query.vaultValues.findFirst({ where: eq(vaultValues.id, a) });
    await db.update(vaultValues).set({ sealed: copied!.sealed }).where(eq(vaultValues.id, b));
    await expect(backend.resolve(b, "value")).rejects.toThrow(/doesn't match/);
  });
});
