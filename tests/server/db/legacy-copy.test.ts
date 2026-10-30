/**
 * The first boot after the move to groot 3.0 copies a Prisma-era database into
 * the Drizzle layout (apps/web/src/server/db/legacy-copy.ts). This builds a
 * database exactly as the last Prisma migrations left it, fills every app
 * table, and checks what the copy produces.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import * as schema from "../../../apps/web/src/server/db/schema";
import {
  convertKeyvEntry,
  isLegacyLayout,
  openAppDatabase,
  toDate,
} from "../../../apps/web/src/server/db/legacy-copy";

const MIGRATIONS = "apps/web/drizzle";
const LAYOUT = readFileSync(path.join(__dirname, "fixtures/prisma-layout.sql"), "utf8");

let dir: string;
let file: string;

function buildLegacyDatabase(): void {
  const sqlite = new Database(file);
  sqlite.exec(LAYOUT);
  sqlite.exec(`INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, applied_steps_count)
               VALUES ('m1', 'x', '20261019153841_add_routines', 0, 1)`);
  const at = "2026-10-20T10:00:00.000+00:00";
  const run = (statement: string, ...params: unknown[]) => sqlite.prepare(statement).run(...params);
  run(
    `INSERT INTO users (id, email, password, name, createdAt, updatedAt) VALUES (1, 'owner@example.com', ?, 'Owner', ?, ?)`,
    "$2b$10$abcdefghijklmnopqrstuuJ8lB0iJ1Hc1yv2bQKcB0Y0E8tWl3b7m",
    at,
    at,
  );
  run(
    `INSERT INTO passkeys (id, userId, credentialId, publicKey, counter, deviceType, backedUp, transports, credentialName, createdAt, updatedAt)
     VALUES (1, 1, 'cred-1', ?, 7, 'multiDevice', 1, '["internal","hybrid"]', 'Laptop', ?, ?)`,
    Buffer.from([1, 2, 3]),
    at,
    at,
  );
  run(
    `INSERT INTO bots (id, name, description, systemPrompt, modelId, conversationId, chatStartedAt, lastActivityAt, toolPermissions, memoryEnabled, autoReview, browserProfile, pinnedAt, createdAt, updatedAt)
     VALUES ('cbot1', 'Ops', 'd', 'p', 'model-x', '41', ?, ?, '{"run_command":"ask"}', 1, 0, 'own', ?, ?, ?)`,
    at,
    at,
    "2026-10-21 08:30:00",
    at,
    at,
  );
  run(
    `INSERT INTO bot_chats (id, botId, conversationId, startedAt, endedAt, title, messageCount) VALUES ('cchat1', 'cbot1', '40', ?, ?, 'Earlier', 3)`,
    at,
    at,
  );
  run(
    `INSERT INTO skills (id, name, description, body, files, source, createdAt, updatedAt) VALUES ('cskill1', 'weekly-report', 'd', 'b', '[]', 'manual', ?, ?)`,
    at,
    at,
  );
  run(`INSERT INTO bot_skills (botId, skillId, createdAt) VALUES ('cbot1', 'cskill1', ?)`, at);
  run(
    `INSERT INTO connections (id, name, slug, url, transport, authType, toolsCache, disabledTools, createdAt, updatedAt)
     VALUES ('cconn1', 'Linear', 'linear', 'https://mcp.example.com', 'streamable-http', 'none', '[]', '[]', ?, ?)`,
    at,
    at,
  );
  run(`INSERT INTO bot_connections (botId, connectionId, createdAt) VALUES ('cbot1', 'cconn1', ?)`, at);
  run(
    `INSERT INTO bot_messages (id, fromBotId, toBotId, kind, requestId, text, createdAt) VALUES ('cmsg1', NULL, 'cbot1', 'mention', 'req-1', 'hi', ?)`,
    at,
  );
  run(
    `INSERT INTO tasks (id, title, description, status, priority, dueAt, createdAt, updatedAt) VALUES ('ctask1', 'Ship', '', 'todo', 'high', ?, ?, ?)`,
    at,
    at,
    at,
  );
  run(
    `INSERT INTO vault_items (id, handle, kind, backend, externalId, label, originsJson, hostsJson, toolsJson, approval, allowUnattended, hasTotp, disabled, createdAt, updatedAt)
     VALUES ('cvault1', 'github', 'login', 'local', 'ext-1', 'GitHub', '["https://github.com"]', '[]', '[]', 'per_conversation', 0, 1, 0, ?, ?)`,
    at,
    at,
  );
  run(
    `INSERT INTO vault_audit_events (id, at, itemId, handle, tool, target, outcome, unattended) VALUES ('caudit1', ?, 'cvault1', 'github', 'vault_ui', 'x', 'created', 0)`,
    at,
  );
  run(
    `INSERT INTO uploads (id, kind, name, mimeType, size, storageKey, createdAt, extractStatus) VALUES ('cup1', 'file', 'a.txt', 'text/plain', 5, 'chat/cup1/original', ?, 'ready')`,
    at,
  );
  run(
    `INSERT INTO routines (id, botId, name, prompt, schedule, enabled, nextRunAt, pendingJobId, blockedStreak, createdAt, updatedAt)
     VALUES ('croutine1', 'cbot1', 'Daily', 'do it', '{"kind":"cron","expression":"0 9 * * *","timezone":"UTC"}', 1, ?, 'honker-job-1', 0, ?, ?)`,
    "2026-11-01T09:00:00.000+00:00",
    at,
    at,
  );
  run(
    `INSERT INTO routine_runs (id, routineId, scheduledFor, status, "trigger", requestId) VALUES ('crun1', 'croutine1', ?, 'succeeded', 'schedule', 'routine:croutine1:x')`,
    at,
  );
  run(
    `INSERT INTO memories (id, botId, text, category, status, source, confidence, createdAt, updatedAt) VALUES ('cmem2', 'cbot1', 'Likes tea', 'preference', 'active', 'capture', 0.9, ?, ?)`,
    at,
    at,
  );
  run(
    `INSERT INTO memories (id, botId, text, category, status, source, supersededById, supersededAt, createdAt, updatedAt) VALUES ('cmem1', 'cbot1', 'Likes coffee', 'preference', 'superseded', 'capture', 'cmem2', ?, ?, ?)`,
    at,
    at,
    at,
  );
  run(
    `INSERT INTO notification_log (id, event, category, channel, dedupeKey, title, priority, status, attempts, createdAt) VALUES ('cnote1', 'system.started', 'system', 'pushover', 'k', 'Started', -1, 'sent', 1, ?)`,
    at,
  );
  const keyv = sqlite.prepare(`INSERT INTO keyv (key, value) VALUES (?, ?)`);
  keyv.run("VAULT_LOCAL:cvault1", JSON.stringify({ value: { iv: "a", data: "b" }, expires: null }));
  keyv.run("APP_SETTING:featureFlags", JSON.stringify({ value: { beta: true }, expires: null }));
  keyv.run("keyv:plain", JSON.stringify({ value: "::colon start", expires: null }));
  keyv.run(
    "passkey:challenge:old",
    JSON.stringify({ value: "c", expires: Date.now() - 60_000 }),
  );
  sqlite.close();
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "legacy-copy-"));
  file = path.join(dir, "app.db");
  buildLegacyDatabase();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("legacy (Prisma) database copy", () => {
  it("recognises the Prisma layout", () => {
    expect(isLegacyLayout(file)).toBe(true);
  });

  it("copies every app row into a fresh Drizzle database and keeps the old file", async () => {
    const db = openAppDatabase(`file:${file}`, { migrationsFolder: MIGRATIONS });

    const backups = readdirSync(dir).filter((name) => name.startsWith("app.db.prisma-backup-"));
    expect(backups.filter((name) => !name.endsWith("-wal") && !name.endsWith("-shm"))).toHaveLength(
      1,
    );
    expect(isLegacyLayout(path.join(dir, backups.find((n) => !n.includes("-wal"))!))).toBe(true);
    expect(isLegacyLayout(file)).toBe(false);

    const [user] = await db.select().from(schema.users);
    expect(user).toMatchObject({ id: 1, email: "owner@example.com", name: "Owner" });
    expect(user!.password.startsWith("$2b$")).toBe(true);
    expect(user!.createdAt).toEqual(new Date("2026-10-20T10:00:00.000Z"));

    const [passkey] = await db.select().from(schema.passkeys);
    expect(passkey).toMatchObject({ counter: 7, backedUp: true, transports: ["internal", "hybrid"] });
    expect([...passkey!.publicKey]).toEqual([1, 2, 3]);

    const bot = await db.query.bots.findFirst({
      where: eq(schema.bots.id, "cbot1"),
      with: { skills: true, connections: true, pastChats: true, routines: true },
    });
    expect(bot).toMatchObject({
      name: "Ops",
      memoryEnabled: true,
      autoReview: false,
      browserProfile: "own",
      toolPermissions: '{"run_command":"ask"}',
    });
    expect(bot!.pinnedAt).toEqual(new Date("2026-10-21T08:30:00.000Z"));
    expect(bot!.skills).toHaveLength(1);
    expect(bot!.connections).toHaveLength(1);
    expect(bot!.pastChats[0]).toMatchObject({ conversationId: "40", messageCount: 3 });

    const [routine] = bot!.routines;
    expect(routine).toMatchObject({
      schedule: { kind: "cron", expression: "0 9 * * *", timezone: "UTC" },
      enabled: true,
      // The old queue's job is gone; routines re-arm on boot.
      pendingJobId: null,
    });
    expect(routine!.nextRunAt).toEqual(new Date("2026-11-01T09:00:00.000Z"));
    expect(await db.$count(schema.routineRuns)).toBe(1);

    const memories = await db.select().from(schema.memories).orderBy(asc(schema.memories.id));
    expect(memories.map((m) => [m.id, m.supersededById])).toEqual([
      ["cmem1", "cmem2"],
      ["cmem2", null],
    ]);
    expect(memories[1]!.confidence).toBeCloseTo(0.9);

    expect(await db.$count(schema.botMessages)).toBe(1);
    expect(await db.$count(schema.tasks)).toBe(1);
    expect(await db.$count(schema.vaultItems)).toBe(1);
    expect(await db.$count(schema.vaultAuditEvents)).toBe(1);
    expect(await db.$count(schema.uploads)).toBe(1);
    expect(await db.$count(schema.notificationLog)).toBe(1);

    const kv = await db.select().from(schema.kv).orderBy(asc(schema.kv.key));
    expect(kv.map((row) => [row.key, JSON.parse(row.value)])).toEqual([
      ["APP_SETTING:featureFlags", { beta: true }],
      ["VAULT_LOCAL:cvault1", { iv: "a", data: "b" }],
      ["plain", ":colon start"],
    ]);
  });

  it("does nothing once the database is in the Drizzle layout", async () => {
    openAppDatabase(`file:${file}`, { migrationsFolder: MIGRATIONS });
    const before = readdirSync(dir).length;
    const db = openAppDatabase(`file:${file}`, { migrationsFolder: MIGRATIONS });
    expect(readdirSync(dir)).toHaveLength(before);
    expect(await db.$count(schema.bots)).toBe(1);
  });

  it("creates a fresh database when there is none", async () => {
    const fresh = path.join(dir, "new.db");
    const db = openAppDatabase(`file:${fresh}`, { migrationsFolder: MIGRATIONS });
    expect(existsSync(fresh)).toBe(true);
    expect(await db.$count(schema.bots)).toBe(0);
  });
});

describe("legacy value conversion", () => {
  it("reads every date shape Prisma and SQLite produce", () => {
    const expected = new Date("2026-10-20T10:00:00.000Z");
    expect(toDate("2026-10-20T10:00:00.000+00:00")).toEqual(expected);
    expect(toDate("2026-10-20 10:00:00")).toEqual(expected);
    expect(toDate(expected.getTime())).toEqual(expected);
    expect(toDate(String(expected.getTime()))).toEqual(expected);
    expect(() => toDate("not a date")).toThrow(/Unreadable date/);
  });

  it("unwraps Keyv entries and drops expired ones", () => {
    expect(convertKeyvEntry({ key: "keyv:a", value: '{"value":[1,2],"expires":null}' })).toEqual({
      key: "a",
      value: "[1,2]",
      expiresAt: null,
    });
    const later = Date.now() + 60_000;
    expect(
      convertKeyvEntry({ key: "NS:b", value: JSON.stringify({ value: "x", expires: later }) }),
    ).toEqual({ key: "NS:b", value: '"x"', expiresAt: new Date(later) });
    expect(
      convertKeyvEntry({ key: "NS:c", value: JSON.stringify({ value: 1, expires: 1 }) }),
    ).toBeUndefined();
    expect(convertKeyvEntry({ key: "NS:d", value: "not json" })).toBeUndefined();
  });
});
