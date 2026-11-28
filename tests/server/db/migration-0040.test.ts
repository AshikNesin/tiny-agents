import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import * as schema from "../../../apps/web/src/server/db/schema";
import { createAppDb, sqliteConnection } from "../../../apps/web/src/server/db";
import { FIXED_NOW } from "../../test-clock";

const MIGRATIONS = "apps/web/drizzle";
const T = Date.parse(FIXED_NOW);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "migration-0040-"));
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

describe("migration 0040", () => {
  it("gives a thread id with no instance its Shelley thread, and leaves the app's own ids alone", async () => {
    const file = path.join(dir, "app.db");
    const before = createAppDb(`file:${file}`, {
      migrationsFolder: migrationsBefore("0040_code_prefix_bare_thread_ids"),
    });
    const old = sqliteConnection(before);
    old
      .prepare(
        "INSERT INTO bots (id, name, conversation_id, chat_started_at, last_activity_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run("ops", "Ops", "1", T, T, T, T);
    const thread = old.prepare(
      "INSERT INTO code_threads (id, instance_id, native_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    );
    thread.run("shelley:cOld", "shelley", "cOld", T, T);
    thread.run("cthreadrow", "shelley", "cMoved", T, T);
    thread.run("cappid", "claude-code", "session-1", T, T);
    const handoff = old.prepare(
      "INSERT INTO code_handoffs (id, bot_id, thread_id, task, idempotency_key, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    handoff.run("h-bare", "ops", "cBare", "t", "k1", "running", T);
    handoff.run("h-old", "ops", "cOld", "t", "k2", "running", T);
    handoff.run("h-moved", "ops", "cMoved", "t", "k3", "running", T);
    handoff.run("h-app", "ops", "cappid", "t", "k4", "running", T);
    handoff.run("h-prefixed", "ops", "claude-code:session-9", "t", "k5", "running", T);
    handoff.run("h-starting", "ops", null, "t", "k6", "starting", T);
    const viewed = old.prepare(
      "INSERT INTO code_review_viewed (thread_id, path, content_hash, created_at) VALUES (?, ?, ?, ?)",
    );
    viewed.run("cOld", "a.ts", "bare", T);
    viewed.run("cOld", "b.ts", "bare", T);
    viewed.run("shelley:cOld", "b.ts", "prefixed", T);
    old
      .prepare(
        "INSERT INTO code_review_drafts (id, thread_id, path, start_line, end_line, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run("d1", "cBare", "a.ts", 1, 1, "Rename", T);
    old
      .prepare(
        "INSERT INTO code_checkpoints (id, thread_id, seq, sha, head_sha, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run("cp1", "cBare", 1, "aaa", "bbb", "turn", T);
    old.close();

    const after = createAppDb(`file:${file}`, { migrationsFolder: MIGRATIONS });
    const handoffs = await after.select().from(schema.codeHandoffs);
    expect(handoffs.map((row) => [row.id, row.threadId]).sort()).toEqual([
      ["h-app", "cappid"],
      ["h-bare", "shelley:cBare"],
      ["h-moved", "cthreadrow"],
      ["h-old", "shelley:cOld"],
      ["h-prefixed", "claude-code:session-9"],
      ["h-starting", null],
    ]);
    const marks = await after.select().from(schema.codeReviewViewed);
    expect(marks.map((row) => [row.threadId, row.path, row.contentHash]).sort()).toEqual([
      ["shelley:cOld", "a.ts", "bare"],
      ["shelley:cOld", "b.ts", "prefixed"],
    ]);
    const drafts = await after.select().from(schema.codeReviewDrafts);
    expect(drafts.map((row) => [row.id, row.threadId])).toEqual([["d1", "shelley:cBare"]]);
    const checkpoints = await after.select().from(schema.codeCheckpoints);
    expect(checkpoints.map((row) => [row.id, row.threadId])).toEqual([["cp1", "shelley:cBare"]]);
    sqliteConnection(after).close();
  });
});
