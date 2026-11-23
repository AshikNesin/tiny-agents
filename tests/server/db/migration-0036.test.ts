import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import * as schema from "../../../apps/web/src/server/db/schema";
import { createAppDb, sqliteConnection } from "../../../apps/web/src/server/db";

const MIGRATIONS = "apps/web/drizzle";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "migration-0036-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function migrationsBefore(tag: string): string {
  const folder = path.join(dir, "drizzle");
  cpSync(MIGRATIONS, folder, { recursive: true });
  const journalPath = path.join(folder, "meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: { tag: string }[];
  };
  const stop = journal.entries.findIndex((entry) => entry.tag === tag);
  writeFileSync(
    journalPath,
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, stop) }),
  );
  return folder;
}

describe("migration 0036", () => {
  it("points Connect-era 1Password items at the service account backend", async () => {
    const file = path.join(dir, "app.db");
    const before = createAppDb(`file:${file}`, {
      migrationsFolder: migrationsBefore("0036_vault_onepassword_backend"),
    });
    const old = sqliteConnection(before);
    const insert = old.prepare(
      "INSERT INTO vault_items (id, handle, kind, backend, external_id, label, created_at, updated_at) VALUES (?, ?, 'login', ?, ?, ?, ?, ?)",
    );
    insert.run("i1", "github", "onepassword-connect", "op-gh", "GitHub", 1, 1);
    insert.run("i2", "umami", "local", "loc-umami", "Umami", 1, 1);
    old.close();

    const after = createAppDb(`file:${file}`, { migrationsFolder: MIGRATIONS });
    const rows = await after.select().from(schema.vaultItems);
    expect(rows.map((row) => [row.handle, row.backend, row.externalId]).sort()).toEqual([
      ["github", "onepassword", "op-gh"],
      ["umami", "local", "loc-umami"],
    ]);
    sqliteConnection(after).close();
  });
});
