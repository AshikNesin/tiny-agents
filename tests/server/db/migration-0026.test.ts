import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import * as schema from "../../../apps/web/src/server/db/schema";
import { createAppDb, sqliteConnection } from "../../../apps/web/src/server/db";

const MIGRATIONS = "apps/web/drizzle";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "migration-0026-"));
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

describe("migration 0026", () => {
  it("copies the Shelley tables into the Code tables before dropping them", async () => {
    const file = path.join(dir, "app.db");
    const before = createAppDb(`file:${file}`, {
      migrationsFolder: migrationsBefore("0026_drop_legacy_columns"),
    });
    const old = sqliteConnection(before);
    const bot = { id: "b1" };
    old
      .prepare(
        "INSERT INTO bots (id, name, conversation_id, chat_started_at, last_activity_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(bot.id, "Coder", "101", ...Array<number>(4).fill(1_700_000_000_000));
    old
      .prepare(
        "INSERT INTO shelley_seen (conversation_id, last_seen_sequence_id, updated_at) VALUES (?, ?, ?)",
      )
      .run("cOld", 7, 1_700_000_000_000);
    old
      .prepare(
        `INSERT INTO shelley_handoffs (id, bot_id, shelley_conversation_id, slug, task, idempotency_key, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("h1", bot.id, "cOld", "old", "t", "legacy-1", "running", 1_700_000_000_000);
    old
      .prepare(
        `INSERT INTO shelley_handoffs (id, bot_id, shelley_conversation_id, slug, task, idempotency_key, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("h2", bot.id, "cOld", null, "t2", "legacy-2", "lost", 1_700_000_000_000);
    old.close();

    const after = createAppDb(`file:${file}`, { migrationsFolder: MIGRATIONS });
    const threads = await after.select().from(schema.codeThreads);
    expect(threads).toMatchObject([
      {
        id: "shelley:cOld",
        instanceId: "shelley",
        nativeId: "cOld",
        followed: true,
        seenCursor: 7,
      },
    ]);
    const handoffs = await after.select().from(schema.codeHandoffs);
    expect(handoffs.map((h) => [h.id, h.threadId, h.title, h.status])).toEqual([
      ["h1", "shelley:cOld", "old", "running"],
      ["h2", "shelley:cOld", null, "finished"],
    ]);
    const tables = sqliteConnection(after)
      .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'shelley_%'")
      .all();
    expect(tables).toEqual([]);
    sqliteConnection(after).close();
  });
});
