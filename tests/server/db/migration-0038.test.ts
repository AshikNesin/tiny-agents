import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import * as schema from "../../../apps/web/src/server/db/schema";
import { createAppDb, sqliteConnection } from "../../../apps/web/src/server/db";

const MIGRATIONS = "apps/web/drizzle";
const T = 1_700_000_000_000;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "migration-0038-"));
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

describe("migration 0038", () => {
  it("shares a connection or skill every bot already had, and keeps narrower ones as they were", async () => {
    const file = path.join(dir, "app.db");
    const before = createAppDb(`file:${file}`, {
      migrationsFolder: migrationsBefore("0038_bots_share_by_default"),
    });
    const old = sqliteConnection(before);
    const bot = old.prepare(
      "INSERT INTO bots (id, name, conversation_id, chat_started_at, last_activity_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    bot.run("ops", "Ops", "1", T, T, T, T);
    bot.run("news", "News", "2", T, T, T, T);
    bot.run("guest", "Guest", "3", T, T, T, T);
    old
      .prepare(
        "INSERT INTO users (id, email, password, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(7, "guest@example.com", "!", T, T);
    old.prepare("INSERT INTO guests (user_id, created_at) VALUES (?, ?)").run(7, T);
    old
      .prepare("INSERT INTO bot_guests (bot_id, user_id, created_at) VALUES (?, ?, ?)")
      .run("guest", 7, T);
    const connection = old.prepare(
      "INSERT INTO connections (id, name, slug, url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    connection.run("gmail", "Gmail", "gmail", "https://gmail.example", T, T);
    connection.run("github", "GitHub", "github", "https://github.example", T, T);
    const link = old.prepare(
      "INSERT INTO bot_connections (bot_id, connection_id, created_at) VALUES (?, ?, ?)",
    );
    link.run("ops", "gmail", T);
    link.run("news", "gmail", T);
    link.run("guest", "gmail", T);
    link.run("ops", "github", T);
    const skill = old.prepare(
      "INSERT INTO skills (id, name, description, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    skill.run("report", "report", "Report", "", T, T);
    skill.run("deploy", "deploy", "Deploy", "", T, T);
    const skillLink = old.prepare(
      "INSERT INTO bot_skills (bot_id, skill_id, created_at) VALUES (?, ?, ?)",
    );
    skillLink.run("ops", "report", T);
    skillLink.run("news", "report", T);
    skillLink.run("news", "deploy", T);
    old.close();

    const after = createAppDb(`file:${file}`, { migrationsFolder: MIGRATIONS });
    const shared = await after.select().from(schema.connections);
    expect(
      shared
        .map((row) => [row.id, row.allBots])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    ).toEqual([
      ["github", false],
      ["gmail", true],
    ]);
    const links = await after.select().from(schema.botConnections);
    expect(links.map((row) => [row.botId, row.connectionId, row.enabled]).sort()).toEqual([
      ["guest", "gmail", true],
      ["ops", "github", true],
    ]);
    const skills = await after.select().from(schema.skills);
    expect(
      skills
        .map((row) => [row.id, row.allBots])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    ).toEqual([
      ["deploy", false],
      ["report", true],
    ]);
    const skillLinks = await after.select().from(schema.botSkills);
    expect(skillLinks.map((row) => [row.botId, row.skillId])).toEqual([["news", "deploy"]]);
    sqliteConnection(after).close();
  });
});
