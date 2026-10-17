import { describe, it, expect, vi } from "vite-plus/test";

vi.mock("@groot/core/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
  createJobLogger: () => ({ info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// The mocked DATABASE_URL must agree with the engine the test leg is
// actually running: the KV store picks its adapter from the varlock ENV
// snapshot (frozen at import, so the real DATABASE_URL the runner exported),
// while the URI it hands the adapter comes from this mocked env. When they
// disagree, KeyvPostgres gets a "file:" URI, the pool fails behind Keyv's
// swallowed errors, and every get() resolves undefined.
//
// So the mock holds two properties, one per leg:
// - postgres leg: TEST_DATABASE_URL starts with "postgres" → use it verbatim
//   as the mocked DATABASE_URL, so adapter choice and URI agree on the live
//   test database. Unique namespaces and timestamped keys keep parallel
//   suites from colliding there.
// - sqlite leg: keep the dedicated "file:./tmp/kv-test.db". Suites run in
//   parallel and the honker-adapter tests poll the shared tmp/test.db
//   concurrently; a second writer there can stall their worker loops past
//   their timeouts. The KV contract doesn't care which file backs it.
// (env must be mocked because varlock resolves ENV into a snapshot at import
// — mutating process.env afterwards has no effect.)
const legDatabaseUrl = process.env.TEST_DATABASE_URL?.startsWith("postgres")
  ? process.env.TEST_DATABASE_URL
  : "file:./tmp/kv-test.db";

vi.mock("@groot/core/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@groot/core/env")>();
  return { env: { ...actual.env, DATABASE_URL: legDatabaseUrl } };
});

/**
 * KV store — persistence + namespace isolation. The namespacing contract is
 * what real consumers rely on: app-settings and passkey services each create
 * their own namespace and must never see each other's keys (an overlap would
 * corrupt stored settings / WebAuthn challenges).
 */
describe("KV System", () => {
  describe("Namespaced KV", () => {
    it("round-trips values (incl. objects) through the store", async () => {
      const { createNamespaceKv } = await import("@groot/core/kv");
      const kv = createNamespaceKv("test-roundtrip");
      const key = `k-${Date.now()}`;

      await kv.set(key, { count: 3, ok: true });
      expect(await kv.get(key)).toEqual({ count: 3, ok: true });

      await kv.delete(key);
      expect(await kv.get(key)).toBeUndefined();
    });

    it("isolates the same key across namespaces", async () => {
      const { createNamespaceKv } = await import("@groot/core/kv");
      const a = createNamespaceKv("test-ns-a");
      const b = createNamespaceKv("test-ns-b");
      const key = `shared-${Date.now()}`;

      await a.set(key, "from-a");
      await b.set(key, "from-b");

      expect(await a.get(key)).toBe("from-a");
      expect(await b.get(key)).toBe("from-b");

      // Deleting in one namespace leaves the other untouched
      await a.delete(key);
      expect(await a.get(key)).toBeUndefined();
      expect(await b.get(key)).toBe("from-b");
    });
  });
});
