import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  connections,
  db,
  vaultAuditEvents,
  vaultItems,
  vaultValues,
} from "../../../../apps/web/src/server/db";
import { setVaultBackendsForTests } from "../../../../apps/web/src/server/api/vault/backends";
import { createLocalBackend } from "../../../../apps/web/src/server/api/vault/backends/local";
import {
  createItem,
  detail,
  linkItem,
  overview,
  reveal,
  updateItem,
} from "../../../../apps/web/src/server/api/vault/vault.admin.service";
import {
  createItemSchema,
  updateItemSchema,
} from "../../../../apps/web/src/server/api/vault/vault.schema";
import {
  clearStatusCache,
  findItem,
} from "../../../../apps/web/src/server/api/vault/vault.service";
import {
  createOAuthProvider,
  readOAuthState,
} from "../../../../apps/web/src/server/api/connections/oauth";

const local = createLocalBackend();

beforeEach(async () => {
  clearStatusCache();
  setVaultBackendsForTests(new Map([["local", local]]));
  await db.delete(vaultAuditEvents);
  await db.delete(vaultItems);
  await db.delete(vaultValues);
});

afterEach(() => {
  for (const table of ["vault_items"]) {
    db.run(sql.raw(`DROP TRIGGER IF EXISTS temp.refuse_${table}_update`));
  }
});

const login = (handle: string, password = `${handle}-pw`) =>
  createItemSchema.parse({
    kind: "login",
    title: handle,
    urls: [`https://${handle}.example.com/login`],
    values: { username: "ana", password },
    policy: { handle },
  });

const draft = (title: string) => ({
  kind: "api_key" as const,
  title,
  values: { value: `${title}-value` },
});

describe("C11: no lost writes, no empty list", () => {
  it("lists every one of many items created at once (no shared index to race on)", async () => {
    const ids = await Promise.all(
      Array.from({ length: 20 }, (_, i) => local.create!(draft(`k${i}`))),
    );
    const listing = await local.listCandidates();
    expect(listing.items.map((item) => item.externalId).sort()).toEqual([...ids].sort());
    expect(listing.unreadable).toEqual([]);
  });

  it("keeps both of two edits to one item made at once", async () => {
    const id = await local.create!({
      kind: "login",
      title: "Both",
      values: { username: "a", password: "b" },
    });
    await Promise.all([
      local.update!(id, { values: { username: "a2" } }),
      local.update!(id, { values: { password: "b2" } }),
      local.update!(id, { title: "Both, edited" }),
    ]);
    expect((await local.resolve(id, "username")).reveal()).toBe("a2");
    expect((await local.resolve(id, "password")).reveal()).toBe("b2");
    expect((await local.describe(id)).title).toBe("Both, edited");
  });

  it("lists the rest when one item can't be read, and shows that one as unreadable", async () => {
    const good = await local.create!(draft("good"));
    const bad = await local.create!(draft("bad"));
    const later = await local.create!(draft("later"));
    await db
      .update(vaultValues)
      .set({ sealed: "v2:not:a:real:value" })
      .where(eq(vaultValues.id, bad));

    const listing = await local.listCandidates();
    expect(listing.items.map((item) => item.externalId)).toEqual([good, later]);
    expect(listing.unreadable).toEqual([
      {
        externalId: bad,
        reason: "The secret was stored under a different SECRETS_KEY. Re-enter it.",
      },
    ]);
    const { unlinked } = await overview({ refresh: true });
    expect(unlinked.map((item) => [item.title, item.kind])).toEqual([
      ["good", "api_key"],
      ["later", "api_key"],
      ["Unreadable item", "other"],
    ]);
  });

  it("keeps every OAuth step two concurrent flows save", async () => {
    await db.insert(connections).values({
      id: "conn-oauth",
      name: "OAuth",
      slug: "oauth",
      url: "https://mcp.example.com/mcp",
      authType: "oauth",
    });
    try {
      const provider = createOAuthProvider("conn-oauth", () => undefined);
      const client = { client_id: "client-1" };
      const tokens = { access_token: "at-1", token_type: "Bearer" };
      await Promise.all([
        provider.saveClientInformation!(client),
        provider.saveTokens(tokens),
        provider.saveCodeVerifier("verifier-1"),
        provider.state!(),
      ]);
      const state = await readOAuthState("conn-oauth");
      expect(state).toMatchObject({ client, tokens, verifier: "verifier-1" });
      expect(state.state).toEqual(expect.any(String));
    } finally {
      await db.delete(connections);
    }
  });
});

describe("S11: every read checks the authoritative policy", () => {
  async function tampered(tamper: (externalId: string) => Promise<void>) {
    await createItem(login("bank"));
    const row = (await findItem("bank"))!;
    expect((await local.resolve(row.externalId, "password")).reveal()).toBe("bank-pw");
    await tamper(row.externalId);
    return row;
  }

  const widenRow = async () => {
    await db
      .update(vaultItems)
      .set({ originsJson: JSON.stringify(["https://bank.example.com", "https://evil.example"]) })
      .where(eq(vaultItems.handle, "bank"));
  };
  const editStoredDigest = async (externalId: string) => {
    await db
      .update(vaultValues)
      .set({ policy: "a-digest-of-my-choosing" })
      .where(eq(vaultValues.id, externalId));
  };

  it.each([
    ["the row's policy widened", widenRow],
    ["the stored digest edited", editStoredDigest],
  ])("%s: list, describe, resolve, reveal and admin describe all fail", async (_, tamper) => {
    const row = await tampered(tamper);

    const listing = await local.listCandidates();
    expect(listing.items).toEqual([]);
    expect(listing.unreadable).toEqual([
      {
        externalId: row.externalId,
        reason: "The stored secret doesn't match its record or policy. Re-enter it.",
      },
    ]);
    await expect(local.describe(row.externalId)).rejects.toThrow(/doesn't match/);
    await expect(local.resolve(row.externalId, "password")).rejects.toThrow(/doesn't match/);
    await expect(reveal("bank", "password", "reveal")).rejects.toMatchObject({ statusCode: 502 });
    expect((await detail("bank")).backendError).toMatch(/doesn't match/);
  });

  it("an unlinked item opens only under the digest it was sealed under", async () => {
    const id = await local.create!(draft("loose"), "its-digest");
    expect((await local.describe(id)).title).toBe("loose");
    await editStoredDigest(id);
    await expect(local.describe(id)).rejects.toThrow(/doesn't match/);
    expect((await local.listCandidates()).unreadable.map((u) => u.externalId)).toEqual([id]);
  });

  it("a policy change through the service re-seals, and opens under the new row", async () => {
    await createItem(login("bank"));
    await updateItem(
      "bank",
      updateItemSchema.parse({
        policy: { origins: ["https://bank.example.com", "https://login.bank.example.com"] },
      }),
    );
    const row = (await findItem("bank"))!;
    expect((await local.resolve(row.externalId, "password")).reveal()).toBe("bank-pw");
    expect((await local.listCandidates()).items.map((item) => item.title)).toEqual(["bank"]);
  });

  it("turning an item off through the request schema keeps the rest of its policy", async () => {
    await createItem(
      createItemSchema.parse({
        kind: "login",
        title: "bank",
        urls: ["https://bank.example.com/login"],
        values: { username: "ana", password: "pw" },
        policy: {
          handle: "bank",
          origins: ["https://bank.example.com"],
          hosts: ["api.bank.example.com"],
          whenToUse: "the work account",
          tools: ["fill_login"],
          bots: ["helper"],
          approval: "allowed",
          allowUnattended: true,
        },
      }),
    );
    const item = await updateItem("bank", updateItemSchema.parse({ policy: { disabled: true } }));
    expect(item).toMatchObject({
      disabled: true,
      origins: ["https://bank.example.com"],
      hosts: ["api.bank.example.com"],
      whenToUse: "the work account",
      tools: ["fill_login"],
      bots: ["helper"],
      approval: "allowed",
      allowUnattended: true,
    });
  });

  it("a row write that fails rolls the re-seal back with it", async () => {
    await createItem(login("bank"));
    db.run(
      sql.raw(
        "CREATE TEMP TRIGGER refuse_vault_items_update BEFORE UPDATE ON vault_items " +
          "BEGIN SELECT RAISE(ABORT, 'row update refused'); END",
      ),
    );
    await expect(
      updateItem(
        "bank",
        updateItemSchema.parse({ policy: { origins: ["https://elsewhere.example.com"] } }),
      ),
    ).rejects.toThrow("row update refused");
    db.run(sql.raw("DROP TRIGGER temp.refuse_vault_items_update"));
    const row = (await findItem("bank"))!;
    expect((await local.resolve(row.externalId, "password")).reveal()).toBe("bank-pw");
  });

  it("two policy edits at once both land, and the item still opens (C11)", async () => {
    await createItem(login("bank"));
    await Promise.all([
      updateItem("bank", { policy: { hosts: ["api.bank.example.com"] } } as never),
      updateItem("bank", {
        policy: { origins: ["https://bank.example.com", "https://login.bank.example.com"] },
      } as never),
    ]);
    const row = (await findItem("bank"))!;
    expect(JSON.parse(row.hostsJson)).toEqual(["api.bank.example.com"]);
    expect(JSON.parse(row.originsJson)).toEqual([
      "https://bank.example.com",
      "https://login.bank.example.com",
    ]);
    expect((await local.resolve(row.externalId, "password")).reveal()).toBe("bank-pw");
  });

  it("resending a policy that changes nothing keeps the item readable", async () => {
    await createItem(login("bank"));
    const before = (await findItem("bank"))!;
    await Promise.all([
      updateItem("bank", { policy: { hosts: ["api.bank.example.com"] } } as never),
      updateItem("bank", { policy: { origins: JSON.parse(before.originsJson) } } as never),
    ]);
    const row = (await findItem("bank"))!;
    expect(JSON.parse(row.hostsJson)).toEqual(["api.bank.example.com"]);
    expect((await local.resolve(row.externalId, "password")).reveal()).toBe("bank-pw");
  });

  it("an edit outside the digest (on/off) still lands on an item that won't open", async () => {
    await createItem(login("bank"));
    const row = (await findItem("bank"))!;
    await db
      .update(vaultValues)
      .set({ sealed: "v2:not:a:real:value" })
      .where(eq(vaultValues.id, row.externalId));
    await updateItem("bank", { policy: { disabled: true } } as never);
    expect((await findItem("bank"))!.disabled).toBe(true);
    await expect(
      updateItem("bank", { policy: { hosts: ["api.bank.example.com"] } } as never),
    ).rejects.toMatchObject({ statusCode: 502 });
  });

  it("two links of one value at once: one wins, the other is refused, it still opens", async () => {
    const id = await local.create!(
      {
        kind: "login",
        title: "Shop",
        urls: ["https://shop.example.com"],
        values: { password: "s" },
      },
      "",
    );
    const results = await Promise.allSettled([
      linkItem({ backend: "local", externalId: id, policy: login("shop-a").policy }),
      linkItem({
        backend: "local",
        externalId: id,
        policy: { ...login("shop-b").policy, origins: ["https://evil.example"] },
      }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(await db.select().from(vaultItems)).toHaveLength(1);
    expect((await local.resolve(id, "password")).reveal()).toBe("s");
  });

  it("refuses to link a value another row already links", async () => {
    await createItem(login("bank"));
    const row = (await findItem("bank"))!;
    await expect(
      linkItem({
        backend: "local",
        externalId: row.externalId,
        policy: { ...login("bank2").policy, origins: ["https://evil.example"] },
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect((await local.resolve(row.externalId, "password")).reveal()).toBe("bank-pw");
  });

  it("links an unlinked value under the new row's policy", async () => {
    const id = await local.create!(
      {
        kind: "login",
        title: "Shop",
        urls: ["https://shop.example.com"],
        values: { password: "s" },
      },
      "",
    );
    await linkItem({ backend: "local", externalId: id, policy: login("shop").policy });
    const row = (await findItem("shop"))!;
    expect(row.originsJson).toBe('["https://shop.example.com"]');
    expect((await local.resolve(id, "password")).reveal()).toBe("s");
    expect(
      (await db.query.vaultValues.findFirst({ where: eq(vaultValues.id, id) }))!.policy,
    ).not.toBe("");
  });
});
