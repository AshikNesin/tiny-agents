import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { storageService } from "@groot/core/storage";
import { db, providers, uploads, vaultItems, vaultValues } from "../../../apps/web/src/server/db";
import { createAccount } from "../../../apps/web/src/server/api/models/models.service";
import { createAccountSchema } from "../../../apps/web/src/server/api/models/models.schema";
import { setReadBackendsForTests } from "../../../apps/web/src/server/api/vault/backends";
import { createLocalBackend } from "../../../apps/web/src/server/api/vault/backends/local";
import {
  createItem,
  setWriteBackendsForTests,
} from "../../../apps/web/src/server/api/vault/vault.admin.service";
import { createItemSchema } from "../../../apps/web/src/server/api/vault/vault.schema";
import { createUpload } from "../../../apps/web/src/server/api/uploads/uploads.service";
import { FAUX_PROVIDER_ID } from "../../../apps/web/src/server/api/models/models.config";

function refuseInserts(table: string): void {
  db.run(
    sql.raw(
      `CREATE TEMP TRIGGER c24_refuse_${table} BEFORE INSERT ON ${table} ` +
        `BEGIN SELECT RAISE(ABORT, 'c24: ${table} insert refused'); END`,
    ),
  );
}

let local: ReturnType<typeof createLocalBackend>;
beforeEach(async () => {
  await db.delete(vaultValues);
  local = createLocalBackend();
  setReadBackendsForTests(new Map([["local", local]]));
  setWriteBackendsForTests(new Map([["local", local]]));
  await db.delete(vaultItems);
});
afterEach(async () => {
  for (const table of ["providers", "vault_items", "uploads"]) {
    db.run(sql.raw(`DROP TRIGGER IF EXISTS temp.c24_refuse_${table}`));
  }
  setReadBackendsForTests(undefined);
  setWriteBackendsForTests(undefined);
  await db.delete(vaultItems);
});

async function unlinkedValues(): Promise<string[]> {
  const linked = new Set((await db.select().from(vaultItems)).map((row) => row.externalId));
  return (await local.listCandidates()).items
    .map((item) => item.externalId)
    .filter((id) => !linked.has(id));
}

describe("C24: a failed second step", () => {
  it("account: the key's vault item stays when the provider row is refused", async () => {
    refuseInserts("providers");
    const input = createAccountSchema.parse({
      kind: "openai-chat",
      baseUrl: "https://llm.example.com/v1",
      apiKey: "sk-c24-orphan-key-000000",
      name: "Orphan",
      discovery: "manual",
      models: ["model-a"],
    });
    await expect(createAccount(input)).rejects.toThrow("c24: providers insert refused");

    const accounts = await db.select().from(providers);
    expect(accounts.map((row) => row.id)).toEqual([FAUX_PROVIDER_ID]);
    const items = await db.select().from(vaultItems);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ label: "Model provider: Orphan", audience: "app" });
    expect(items[0]!.handle).toMatch(/^provider-orphan-[0-9a-f]{6}$/);
    expect((await local.listCandidates()).items).toHaveLength(1);
  });

  it("vault item: the stored value stays when its row is refused", async () => {
    refuseInserts("vault_items");
    const input = createItemSchema.parse({
      kind: "login",
      title: "GitHub",
      urls: ["https://github.com/login"],
      values: { username: "ana", password: "c24-secret" },
      policy: { handle: "github" },
    });
    await expect(createItem(input)).rejects.toThrow("c24: vault_items insert refused");

    expect(await db.select().from(vaultItems)).toEqual([]);
    const orphans = await unlinkedValues();
    expect(orphans).toHaveLength(1);
    expect((await local.listCandidates()).items[0]).toMatchObject({ title: "GitHub" });
  });

  it("upload: the stored original stays when its row is refused", async () => {
    refuseInserts("uploads");
    const before = await storageService.listFiles({ folder: "chat/" });
    const bytes = Buffer.from("notes for c24\n");
    await expect(
      createUpload({ name: "notes.txt", mimeType: "text/plain", bytes, uploadedBy: 1 }),
    ).rejects.toThrow("c24: uploads insert refused");

    const after = await storageService.listFiles({ folder: "chat/" });
    const added = after.filter((dir) => !before.some((old) => old.key === dir.key));
    expect(added).toHaveLength(1);
    const original = await storageService.downloadFile({ filePath: `${added[0]!.key}original` });
    expect(Buffer.from(original.bytes).equals(bytes)).toBe(true);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    expect(
      await db
        .select()
        .from(uploads)
        .where(sql`${uploads.sha256} = ${sha256}`),
    ).toEqual([]);
  });

  it("upload: an image that will not decode leaves its original with no row, no trigger needed", async () => {
    const before = await storageService.listFiles({ folder: "chat/" });
    const bytes = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("not really a png at all"),
    ]);
    await expect(
      createUpload({ name: "broken.png", mimeType: "image/png", bytes, uploadedBy: 1 }),
    ).rejects.toThrow("This image could not be decoded (corrupt or unsupported).");

    const after = await storageService.listFiles({ folder: "chat/" });
    const added = after.filter((dir) => !before.some((old) => old.key === dir.key));
    expect(added).toHaveLength(1);
    const original = await storageService.downloadFile({ filePath: `${added[0]!.key}original` });
    expect(Buffer.from(original.bytes).equals(bytes)).toBe(true);
    expect(await db.select().from(uploads)).toEqual([]);
  });
});
