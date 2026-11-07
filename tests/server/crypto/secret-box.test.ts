import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { connections, db } from "../../../apps/web/src/server/db";
import {
  needsReseal,
  open,
  seal,
  SecretLockedError,
  type SecretBinding,
} from "../../../apps/web/src/server/crypto/secret-box";
import {
  openHeaderSecret,
  resealConnectionSecrets,
  sealHeaderSecret,
} from "../../../apps/web/src/server/api/connections/connection-secrets";
import {
  createLocalBackend,
  resealLocalItems,
  type LocalStore,
} from "../../../apps/web/src/server/api/vault/backends/local";

const KEY = process.env.SECRETS_KEY!;
const binding: SecretBinding = { purpose: "connection", record: "c1", field: "secret_enc" };

afterEach(() => {
  process.env.SECRETS_KEY = KEY;
  delete process.env.SECRETS_KEY_PREVIOUS;
});

function memoryStore(): LocalStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (key) => data.get(key),
    set: async (key, value) => void data.set(key, value),
    delete: async (key) => void data.delete(key),
  };
}

function lockReason(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof SecretLockedError) return error.reason;
    throw error;
  }
  return undefined;
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
    process.env.SECRETS_KEY = "the-new-key";
    process.env.SECRETS_KEY_PREVIOUS = KEY;
    expect(open(stored, binding)).toBe("sk-sentinel");
    expect(needsReseal(stored, "connection")).toBe(true);
    expect(needsReseal(seal("x", binding), "connection")).toBe(false);
  });
});

describe("secrets:rotate", () => {
  it("re-seals local vault items and connection secrets under the new key", async () => {
    const store = memoryStore();
    const backend = createLocalBackend(store);
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
      .set({ secretEnc: sealHeaderSecret(row!.id, "h-1") })
      .where(eq(connections.id, row!.id));

    process.env.SECRETS_KEY = "the-new-key";
    process.env.SECRETS_KEY_PREVIOUS = KEY;
    expect(await resealLocalItems(store)).toBe(1);
    expect(await resealConnectionSecrets()).toBe(1);
    expect(await resealLocalItems(store)).toBe(0);

    delete process.env.SECRETS_KEY_PREVIOUS;
    expect((await backend.resolve(itemId, "value")).reveal()).toBe("v-1");
    const after = await db.query.connections.findFirst({ where: eq(connections.id, row!.id) });
    expect(openHeaderSecret(row!.id, after!.secretEnc!)).toBe("h-1");
  });

  it("a local item copied under another id doesn't open", async () => {
    const store = memoryStore();
    const backend = createLocalBackend(store);
    const a = await backend.create!({ kind: "api_key", title: "A", values: { value: "a" } });
    const b = await backend.create!({ kind: "api_key", title: "B", values: { value: "b" } });
    store.data.set(b, store.data.get(a)!);
    await expect(backend.resolve(b, "value")).rejects.toThrow(/doesn't match/);
  });
});
