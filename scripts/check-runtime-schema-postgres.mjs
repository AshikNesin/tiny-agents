#!/usr/bin/env node
/**
 * Migration ownership check (PostgreSQL, pg-boss).
 *
 * The Postgres twin of check-runtime-schema.mjs. On this engine the job queue
 * is pg-boss, which vendors its own migrations and keeps its tables in a
 * dedicated `pgboss` schema rather than the `public` schema Prisma migrates.
 * The ownership invariants that follow are containment-shaped:
 *
 * SCOPE vs the sqlite check: this is deliberately narrower. The sqlite twin
 * fails on column-level drift inside honker's tables (renamed column,
 * changed type, flipped default, swapped index order); this check cannot see
 * such drift inside the pgboss schema, because pg-boss migrates its own
 * tables and no canonical independent shape exists to diff against. What it
 * does catch: any pgboss object appearing in `public`, any migrated public
 * table vanishing, and any migrated table with no @@map model owner. Do not
 * assume parity with the sqlite leg when reasoning about a Postgres change.
 *
 *  1. Apply every migration in apps/web/prisma/migrations-postgres to a
 *     scratch database, then boot the real pg-boss package against it and
 *     exercise it (create a queue, send a job). pg-boss must not create,
 *     alter, or drop anything in `public` (`RUNTIME_SCHEMA_DRIFT`).
 *  2. Every table migrations created in `public` must have a model
 *     declaration in schema.postgres.prisma (`PRISMA_MODEL_MISSING`), so no
 *     migration ships a table the schema disowns.
 *  3. The pgboss schema must exist and hold tables after the boot, so the
 *     check can never pass vacuously.
 *
 * The scratch database is created and dropped by this script; nothing here
 * touches a real application database. Requires a Postgres reachable through
 * DATABASE_URL whose user may CREATE DATABASE.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { PgBoss } from "pg-boss";

const migrationsDir = path.join("apps/web", "prisma", "migrations-postgres");
const schemaPath = path.join("apps/web", "prisma", "schema.postgres.prisma");

const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl || !sourceUrl.trim().startsWith("postgres")) {
  console.error("check:schema:postgres needs a postgresql:// DATABASE_URL.");
  process.exit(1);
}

const scratchName = `groot_schema_check_${Date.now().toString(36)}`;
const admin = new pg.Client({ connectionString: sourceUrl });
await admin.connect();

/** Run one phase with the scratch database always dropped afterwards. */
async function withScratchDb(run) {
  await admin.query(`DROP DATABASE IF EXISTS "${scratchName}"`);
  await admin.query(`CREATE DATABASE "${scratchName}"`);
  const url = new URL(sourceUrl);
  url.pathname = `/${scratchName}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    return await run(client, url.toString());
  } finally {
    await client.end();
    await admin.query(`DROP DATABASE IF EXISTS "${scratchName}"`);
  }
}

await withScratchDb(async (client, scratchUrl) => {
  // 1. Apply every migration in order, the same order prisma migrate deploy uses.
  const applied = [];
  for (const entry of readdirSync(migrationsDir).sort()) {
    if (entry === "migration_lock.toml") continue;
    const sql = readFileSync(path.join(migrationsDir, entry, "migration.sql"), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(
        `RUNTIME_SCHEMA_DRIFT migration ${entry} failed to apply cleanly: ${error.message}`,
      );
      process.exitCode = 1;
      return;
    }
    applied.push(entry);
  }

  const objectsIn = (schema) =>
    client
      .query(
        "SELECT table_name, table_type FROM information_schema.tables " +
          "WHERE table_schema = $1 AND table_name NOT LIKE 'sqlite_%' ORDER BY table_name",
        [schema],
      )
      .then((r) => r.rows);

  const publicBefore = await objectsIn("public");
  const publicBeforeNames = new Set(publicBefore.map((r) => r.table_name));

  // 2. Boot the real pg-boss package against the migrated scratch database
  // and exercise the surface that owns its tables.
  const boss = new PgBoss({ connectionString: scratchUrl, max: 2 });
  await boss.start();
  await boss.createQueue("ownership-check");
  await boss.send("ownership-check", { probe: true });
  const schedules = await boss.getSchedules().catch(() => []);

  const publicAfter = await objectsIn("public");
  const pgbossTables = await objectsIn("pgboss");

  let failures = 0;
  for (const row of publicAfter) {
    if (!publicBeforeNames.has(row.table_name)) {
      console.error(
        `RUNTIME_SCHEMA_DRIFT table public.${row.table_name} was created by pg-boss at runtime, outside its own schema; record queue tables in a migration before shipping.`,
      );
      failures += 1;
    }
  }
  for (const name of publicBeforeNames) {
    if (!publicAfter.some((r) => r.table_name === name)) {
      console.error(
        `RUNTIME_SCHEMA_DRIFT table public.${name} was removed by pg-boss at runtime; migrations and runtime disagree.`,
      );
      failures += 1;
    }
  }

  // 3. Model declarations: every migration-created table needs a @@map owner.
  const schema = readFileSync(schemaPath, "utf8");
  const declared = new Set([...schema.matchAll(/@@map\("([^"]+)"\)/gu)].map((match) => match[1]));
  for (const row of publicAfter) {
    if (!declared.has(row.table_name)) {
      console.error(
        `PRISMA_MODEL_MISSING public.${row.table_name}; model migration-managed tables explicitly in the Prisma schema.`,
      );
      failures += 1;
    }
  }

  // 4. The check must have exercised a real bootstrap, never pass vacuously.
  if (pgbossTables.length === 0) {
    console.error(
      "RUNTIME_SCHEMA_DRIFT pgboss schema holds no tables; the bootstrap never ran and this check proved nothing.",
    );
    failures += 1;
  }

  await boss.stop();

  console.log(
    `checked ${publicAfter.length} public tables and ${pgbossTables.length} pgboss tables; ${failures} ownership errors; ` +
      `${applied.length} migrations; ${schedules.length} schedules; scratch DB ${scratchName}`,
  );
  process.exitCode = failures ? 1 : 0;
});

await admin.end();
