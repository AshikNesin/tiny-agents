/**
 * The Q4 data migration (`vault.import.ts`): an install written by the
 * pre-Q4 code (vault values in the KV store under `VAULT_LOCAL:`, listed by
 * `__index`; a connection's header value sealed in `connections.secret_enc`)
 * keeps every secret. The seeds below are byte for byte what that code wrote
 * (`backends/local.ts` and `connection-secrets.ts` at f1be918).
 */
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createNamespaceKv } from "@groot/core/kv";
import {
  connections,
  db,
  kv,
  vaultAuditEvents,
  vaultItems,
  vaultValues,
} from "../../../../apps/web/src/server/db";
import { sealJson } from "../../../../apps/web/src/server/crypto/secret-box";
import { sealHeaderSecret } from "../../../../apps/web/src/server/api/connections/connection-secrets";
import { setReadBackendsForTests } from "../../../../apps/web/src/server/api/vault/backends";
import { createLocalBackend } from "../../../../apps/web/src/server/api/vault/backends/local";
import {
  clearStatusCache,
  resolveConnectionSecret,
} from "../../../../apps/web/src/server/api/vault/vault.service";
import { vaultPolicyDigest } from "../../../../apps/web/src/server/api/vault/vault.policy";
import {
  importConnectionSecrets,
  importStoredSecrets,
  importVaultValues,
  moveConnectionSecret,
} from "../../../../apps/web/src/server/api/vault/vault.import";

const KEY = process.env.SECRETS_KEY!;
const oldKv = createNamespaceKv("VAULT_LOCAL");
const local = createLocalBackend();

interface OldItem {
  kind: string;
  title: string;
  urls: string[];
  values: Record<string, string>;
  updatedAt: string;
}

/** The pre-Q4 local backend's `seal()` and `store.set()`: `{policy, sealed}` as a JSON string. */
async function seedOldItem(id: string, item: OldItem, policy: string): Promise<void> {
  const sealed = sealJson(item, { purpose: "vault-local", record: id, field: "item", policy });
  await oldKv.set(id, JSON.stringify({ policy, sealed }));
}

async function seedOldIndex(ids: string[]): Promise<void> {
  await oldKv.set("__index", JSON.stringify(ids));
}

/** A `vault_items` row linking `externalId`, as the pre-Q4 admin service wrote it; returns its digest. */
async function linkRow(
  handle: string,
  externalId: string,
  policy: Partial<typeof vaultItems.$inferInsert>,
) {
  const [row] = await db
    .insert(vaultItems)
    .values({ handle, kind: "login", backend: "local", externalId, label: handle, ...policy })
    .returning();
  return vaultPolicyDigest(row!);
}

const ITEM = (title: string, values: Record<string, string>, kind = "login"): OldItem => ({
  kind,
  title,
  urls: [`https://${title.toLowerCase()}.example.com/login`],
  values,
  updatedAt: "2026-11-01T00:00:00.000Z",
});

const IDS = {
  github: "00000000-0000-4000-8000-000000000001",
  bank: "00000000-0000-4000-8000-000000000002",
  loose: "00000000-0000-4000-8000-000000000003",
  lost: "00000000-0000-4000-8000-000000000004",
};

/** Seed an old install: two linked items, one unlinked, one the index lost (C11). */
async function seedOldInstall() {
  const github = await linkRow("github", IDS.github, {
    originsJson: JSON.stringify(["https://github.example.com"]),
  });
  await seedOldItem(IDS.github, ITEM("GitHub", { username: "ana", password: "gh-pw-1" }), github);
  const bank = await linkRow("bank", IDS.bank, {
    kind: "api_key",
    hostsJson: JSON.stringify(["api.bank.example.com"]),
    injectJson: JSON.stringify({ as: "header", name: "Authorization", format: "Bearer {value}" }),
    field: "value",
  });
  await seedOldItem(IDS.bank, ITEM("Bank", { value: "sk-bank-1" }, "api_key"), bank);
  // Unlinked: sealed under the digest of a row since unlinked.
  await seedOldItem(IDS.loose, ITEM("Loose", { password: "loose-pw" }), "digest-of-a-deleted-row");
  // Written, but its id never reached the index (a lost read-modify-write).
  await seedOldItem(IDS.lost, ITEM("Lost", { password: "lost-pw" }), "");
  await seedOldIndex([IDS.github, IDS.bank, IDS.loose]);
  return { github, bank };
}

const kvKeys = async () =>
  (
    await db
      .select({ key: kv.key })
      .from(kv)
      .where(sql`${kv.key} like 'VAULT_LOCAL:%'`)
  ).map((row) => row.key);

beforeEach(() => {
  setReadBackendsForTests(new Map([["local", local]]));
  clearStatusCache();
});

afterEach(async () => {
  process.env.SECRETS_KEY = KEY;
  setReadBackendsForTests(undefined);
  await oldKv.clear();
  await db.delete(connections);
  await db.delete(vaultAuditEvents);
  await db.delete(vaultItems);
  await db.delete(vaultValues);
});

describe("Q4 import: vault values from the KV store", () => {
  it("moves every item, each resolving with the same value under the same policy", async () => {
    const { github, bank } = await seedOldInstall();

    const report = importVaultValues();
    expect(report).toEqual({
      moved: [IDS.github, IDS.bank, IDS.loose, IDS.lost],
      alreadyMoved: [],
      unreadable: [],
      failed: [],
    });

    // Same ids and policy digests in the table, and nothing left in KV.
    const rows = await db.select().from(vaultValues);
    expect(Object.fromEntries(rows.map((row) => [row.id, row.policy]))).toEqual({
      [IDS.github]: github,
      [IDS.bank]: bank,
      [IDS.loose]: "digest-of-a-deleted-row",
      [IDS.lost]: "",
    });
    expect(await kvKeys()).toEqual([]);

    // Every value resolves as before, linked ones under their row's policy.
    expect((await local.resolve(IDS.github, "password")).reveal()).toBe("gh-pw-1");
    expect((await local.resolve(IDS.github, "username")).reveal()).toBe("ana");
    expect((await local.resolve(IDS.bank, "value")).reveal()).toBe("sk-bank-1");
    expect((await local.resolve(IDS.loose, "password")).reveal()).toBe("loose-pw");
    expect((await local.resolve(IDS.lost, "password")).reveal()).toBe("lost-pw");
    const listing = await local.listCandidates();
    expect(listing.items.map((item) => item.title)).toEqual(["GitHub", "Bank", "Loose", "Lost"]);
    expect(listing.unreadable).toEqual([]);
  });

  it("is idempotent: a second run moves nothing and changes nothing", async () => {
    await seedOldInstall();
    importVaultValues();
    const before = await db.select().from(vaultValues);

    expect(importVaultValues()).toEqual({
      moved: [],
      alreadyMoved: [],
      unreadable: [],
      failed: [],
    });
    expect(await db.select().from(vaultValues)).toEqual(before);
  });

  it("keeps the table's newer copy when a stale KV entry is still there", async () => {
    await seedOldInstall();
    importVaultValues();
    await local.update!(IDS.github, { values: { password: "gh-pw-2" } });
    await seedOldItem(IDS.github, ITEM("GitHub", { password: "gh-pw-1" }), "stale");

    expect(importVaultValues().alreadyMoved).toEqual([IDS.github]);
    expect((await local.resolve(IDS.github, "password")).reveal()).toBe("gh-pw-2");
    expect(await kvKeys()).toEqual([]);
  });

  it("moves the rest past a corrupt entry, and reports and keeps the bad one", async () => {
    await seedOldInstall();
    await oldKv.set("corrupt", "{not json");
    await db.insert(kv).values({ key: "VAULT_LOCAL:garbled", value: "not even json" });
    await seedOldIndex([IDS.github, IDS.bank, IDS.loose, "corrupt", "missing"]);

    const report = importVaultValues();
    expect(report.moved).toEqual([IDS.github, IDS.bank, IDS.loose, IDS.lost]);
    expect(report.failed).toEqual([
      { id: "missing", reason: "named by __index, but has no entry" },
      { id: "corrupt", reason: "not a vault entry in the pre-Q4 format" },
      { id: "garbled", reason: "not a vault entry in the pre-Q4 format" },
    ]);
    // The bad entries and the index stay for the owner to see; the rest moved.
    expect((await kvKeys()).sort()).toEqual([
      "VAULT_LOCAL:__index",
      "VAULT_LOCAL:corrupt",
      "VAULT_LOCAL:garbled",
    ]);
    expect((await local.resolve(IDS.bank, "value")).reveal()).toBe("sk-bank-1");

    // Once the bad ones are gone the index goes too.
    await oldKv.delete("corrupt");
    await oldKv.delete("garbled");
    await seedOldIndex([IDS.github]);
    expect(importVaultValues().failed).toEqual([]);
    expect(await kvKeys()).toEqual([]);
  });

  it("moves an entry another SECRETS_KEY sealed, and says it doesn't open", async () => {
    process.env.SECRETS_KEY = "an-older-key";
    await seedOldItem(IDS.loose, ITEM("Loose", { password: "x" }), "");
    process.env.SECRETS_KEY = KEY;

    const report = importVaultValues();
    expect(report.moved).toEqual([IDS.loose]);
    expect(report.unreadable).toEqual([
      {
        id: IDS.loose,
        reason: "The secret was stored under a different SECRETS_KEY. Re-enter it.",
      },
    ]);
    // Nothing lost: it opens once the old key is back as SECRETS_KEY_PREVIOUS.
    process.env.SECRETS_KEY_PREVIOUS = "an-older-key";
    try {
      expect((await local.resolve(IDS.loose, "password")).reveal()).toBe("x");
    } finally {
      delete process.env.SECRETS_KEY_PREVIOUS;
    }
  });
});

describe("Q4 import: connection header values become vault items", () => {
  async function oldConnection(id: string, slug: string, value: string, secretRef?: string) {
    await db.insert(connections).values({
      id,
      name: `Server ${slug}`,
      slug,
      url: `https://${slug}.example.com/mcp`,
      authType: "header",
      headerName: "x-api-key",
      secretEnc: sealHeaderSecret(id, value),
      secretRef: secretRef ?? null,
    });
  }

  it("moves each value into the connection's own item, which resolves for it", async () => {
    await oldConnection("conn-a", "alpha", "alpha-secret");
    await oldConnection("conn-b", "beta", "beta-secret", "shared-key");

    expect(importConnectionSecrets()).toEqual({ moved: ["conn-a", "conn-b"], failed: [] });

    const rows = await db.select().from(connections).orderBy(connections.slug);
    expect(rows.map((row) => row.secretEnc)).toEqual([null, null]);
    // The owner's pick stays first; the moved value is its own item behind it.
    expect(rows.map((row) => row.secretRef)).toEqual([null, "shared-key"]);
    const items = await db.select().from(vaultItems).orderBy(vaultItems.handle);
    expect(items.map((item) => item.id)).toEqual(rows.map((row) => row.secretItemId));
    expect(items).toMatchObject([
      {
        handle: "mcp-alpha",
        kind: "api_key",
        audience: "bots",
        label: "MCP connection: Server alpha",
        hostsJson: '["alpha.example.com"]',
        toolsJson: '["mcp"]',
        botsJson: "[]",
        field: "value",
      },
      { handle: "mcp-beta" },
    ]);
    expect(await resolveConnectionSecret("mcp-alpha", "alpha")).toBe("alpha-secret");
    expect(await resolveConnectionSecret("mcp-beta", "beta")).toBe("beta-secret");
    const created = await db
      .select()
      .from(vaultAuditEvents)
      .where(eq(vaultAuditEvents.outcome, "created"));
    expect(created.map((event) => [event.handle, event.tool])).toEqual([
      ["mcp-alpha", "vault_import"],
      ["mcp-beta", "vault_import"],
    ]);

    // Idempotent.
    expect(importConnectionSecrets()).toEqual({ moved: [], failed: [] });
    expect(await db.select().from(vaultItems)).toHaveLength(2);
  });

  it("leaves a value it can't open where it is, and moves it once it can", async () => {
    await oldConnection("conn-a", "alpha", "alpha-secret");
    delete process.env.SECRETS_KEY;
    expect(importConnectionSecrets()).toEqual({
      moved: [],
      failed: [{ id: "conn-a", reason: "SECRETS_KEY is not set" }],
    });
    process.env.SECRETS_KEY = "another-key";
    expect(importConnectionSecrets().failed).toEqual([
      {
        id: "conn-a",
        reason: "The secret was stored under a different SECRETS_KEY. Re-enter it.",
      },
    ]);
    const row = await db.query.connections.findFirst();
    expect(row?.secretEnc).not.toBeNull();
    expect(await db.select().from(vaultItems)).toEqual([]);

    process.env.SECRETS_KEY = KEY;
    expect(importConnectionSecrets().moved).toEqual(["conn-a"]);
    expect(await resolveConnectionSecret("mcp-alpha", "alpha")).toBe("alpha-secret");
  });

  it("a second import working from a row read before the first moved it does nothing", async () => {
    await oldConnection("conn-a", "alpha", "alpha-secret");
    // What a concurrent run (a boot and `secrets:rotate`) read before this one moved it.
    const [stale] = await db.select().from(connections);
    expect(importConnectionSecrets().moved).toEqual(["conn-a"]);
    expect(moveConnectionSecret(stale!)).toBe(false);
    expect((await db.select().from(vaultItems)).map((item) => item.handle)).toEqual(["mcp-alpha"]);
  });

  it("runs both moves at start", async () => {
    await seedOldInstall();
    await oldConnection("conn-a", "alpha", "alpha-secret");
    const report = importStoredSecrets();
    expect(report.values.moved).toHaveLength(4);
    expect(report.connections.moved).toEqual(["conn-a"]);
    expect(importStoredSecrets()).toEqual({
      values: { moved: [], alreadyMoved: [], unreadable: [], failed: [] },
      connections: { moved: [], failed: [] },
    });
  });
});
