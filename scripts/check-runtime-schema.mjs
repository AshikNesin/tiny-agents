#!/usr/bin/env node
/**
 * Migration ownership check (SQLite).
 *
 * Applies every migration in apps/web/prisma/migrations-sqlite to a scratch
 * database, opens the real @russellthehippo/honker-node package against that
 * same file, and diffs what the runtime creates against two sources of truth:
 *
 *  1. Migration state. An object honker creates that no migration created is
 *     unmanaged drift (`RUNTIME_SCHEMA_DRIFT`).
 *  2. The Prisma schema. A runtime-managed table that no model declares with
 *     `@@map` + `@@ignore` has no recorded owner (`PRISMA_MODEL_MISSING`).
 *
 * Beyond the P4 prototype, tables and indexes are compared by normalized
 * definition (column name/type/default, primary key, and the index column
 * list, order, uniqueness, and partial-index predicate; nullability is not
 * compared — see tableShape for why), not only by name, so a migration that
 * ships a near-miss shape of a runtime table still fails. Reports
 * MIGRATION_SCHEMA_MISMATCH in that case. The runtime side of that comparison
 * comes from a second scratch DB honker bootstraps on its own, because
 * CREATE TABLE IF NOT EXISTS leaves an already-migrated table untouched and
 * would otherwise just mirror the migration's own drift back as a pass.
 *
 * Postgres asymmetry: the companion check-runtime-schema-postgres.mjs is
 * containment-shaped by design (pg-boss vendors its own schema), so it does
 * NOT catch the column-level drifts this sqlite check catches (a renamed
 * column, a changed type, a flipped uniqueness inside the pgboss schema pass
 * it silently). See that script's header for the full scope line.
 *
 * Scratch files live in a mkdtemp directory; nothing here touches a real
 * application database.
 */
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import honker from "@russellthehippo/honker-node";

const migrationsDir = path.join("apps/web", "prisma", "migrations-sqlite");
const schemaPath = path.join("apps/web", "prisma", "schema.sqlite.prisma");

/** Every table and index in sqlite_master, excluding sqlite's own objects. */
function readObjects(db) {
  return db
    .prepare(
      "SELECT type, name, tbl_name, sql FROM sqlite_master " +
        "WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )
    .all();
}

/**
 * Normalized table shape from PRAGMA table_info: ordered column list of
 * `name:type:default:is-pk`. NOT NULL is deliberately dropped: a SQLite
 * INTEGER PRIMARY KEY column reads notnull=0 on one side and 1 on the other
 * for the same physical column (bare `id INTEGER PRIMARY KEY` vs
 * `"id" INTEGER NOT NULL PRIMARY KEY`), and NOT NULL is implied for every
 * PRIMARY KEY column, so it carries no signal. Primary-key membership is
 * kept separately.
 */
function tableShape(db, name) {
  const cols = db.prepare(`PRAGMA table_info(${JSON.stringify(name)})`).all();
  const columns = cols.map((c) =>
    [
      c.name,
      String(c.type).toUpperCase(),
      `DEFAULT ${c.dflt_value ?? "NONE"}`,
      c.pk ? "PK" : "",
    ].join(":"),
  );
  const pk = cols.filter((c) => c.pk).map((c) => c.name);
  return { columns, pk: pk.join(",") };
}

/** Normalize a double-quoted SQL identifier list to bare tokens. */
function parseIdentList(text) {
  return text
    .split(",")
    .map((part) => part.trim().replace(/"/gu, "").replace(/\s+/gu, " ").trim())
    .join(",");
}

/**
 * Normalized index shape from the CREATE INDEX statement: column list with
 * DESC markers preserved, uniqueness, and the partial-index WHERE predicate
 * with quoting/whitespace removed. sqlite_master stores the statement exactly
 * as each creator wrote it, so quoting style is the only expected difference.
 */
function indexShape(sql) {
  const text = sql.replace(/\s+/gu, " ").trim();
  const unique = /^CREATE UNIQUE INDEX/iu.test(text) ? "UNIQUE" : "";
  const m = text.match(
    /^CREATE (?:UNIQUE )?INDEX "?([^"]+?)"? ON "?([^"]+?)"?\s*\((.*)\)(?: WHERE (.*))?$/iu,
  );
  if (!m) return { raw: text };
  const columns = parseIdentList(m[3])
    .split(",")
    .map((c) => c.replace(/\s+/gu, " ").trim());
  const where = m[4]
    ? m[4]
        .replace(/"([a-zA-Z_0-9]+)"/gu, "$1")
        .replace(/'([^']*)'/gu, "$1")
        .replace(/\s+/gu, " ")
        .trim()
    : null;
  return { unique, columns: columns.join(","), where };
}

const shapeOf = (db, obj) =>
  obj.type === "table" ? tableShape(db, obj.name) : indexShape(obj.sql);
const shapeKey = (s) => {
  if (s.raw !== undefined) return `raw:${s.raw}`;
  if (s.pk !== undefined) return `${s.columns.join("|")}|pk=${s.pk}`;
  return `${s.unique} ${s.columns} where=${s.where}`;
};

const dir = mkdtempSync(path.join(tmpdir(), "groot-schema-check-"));
const dbFile = path.join(dir, "test.db");
const db = new Database(dbFile);

// 1. Apply every migration in lexicographic (timestamp) order, the same order
// prisma migrate deploy uses.
const applied = [];
for (const entry of readdirSync(migrationsDir).sort()) {
  if (entry === "migration_lock.toml") continue;
  const sql = readFileSync(path.join(migrationsDir, entry, "migration.sql"), "utf8");
  db.exec(sql);
  applied.push(entry);
}

const before = readObjects(db);
const beforeByKey = new Map(before.map((o) => [`${o.type}:${o.name}`, o]));

// 2. Open the real honker package on the migrated file and exercise the
// surface that owns tables: queue enqueue+claim, scheduler, stream.
const runtime = honker.open(dbFile);
const queue = new honker.Queue(runtime, "ownership-check");
queue.enqueue({ probe: true });
queue.claimBatch("ownership-check-worker", 1);
new honker.Scheduler(runtime).add({
  name: "ownership-check",
  queue: "ownership-check",
  cron: "* * * * *",
  payload: {},
});
new honker.Stream(runtime, "ownership-check").publish("probe", "{}");

const after = readObjects(db);

// 3. Honker's own canonical shape. Bootstrap a second, empty scratch DB and
// let the package build its schema there unmodified. That is the definition
// the runtime owns, independent of what the migrations happened to create.
const freshFile = path.join(dir, "honker-fresh.db");
const freshRuntime = honker.open(freshFile);
const freshQueue = new honker.Queue(freshRuntime, "ownership-check");
freshQueue.enqueue({ probe: true });
freshQueue.claimBatch("ownership-check-worker", 1);
new honker.Scheduler(freshRuntime).add({
  name: "ownership-check",
  queue: "ownership-check",
  cron: "* * * * *",
  payload: {},
});
new honker.Stream(freshRuntime, "ownership-check").publish("probe", "{}");
const freshDb = new Database(freshFile);
const freshByKey = new Map(readObjects(freshDb).map((o) => [`${o.type}:${o.name}`, o]));

// 4. Model declarations: every @@map(...) in the schema records a table owner.
// A table the runtime manages must appear here, or no model claims it.
const schema = readFileSync(schemaPath, "utf8");
const declared = new Set([...schema.matchAll(/@@map\("([^"]+)"\)/gu)].map((match) => match[1]));

let failures = 0;
let mismatches = 0;
const runtimeObjects = new Map(after.map((o) => [`${o.type}:${o.name}`, o]));
for (const [key, obj] of runtimeObjects) {
  const prior = beforeByKey.get(key);
  if (!prior) {
    console.error(
      `RUNTIME_SCHEMA_DRIFT ${obj.type} ${obj.name} was created at runtime, absent from migrations; use the Prisma migration workflow before shipping.`,
    );
    failures += 1;
  }
  // Definition comparison against the package's own canonical bootstrap,
  // which holds for both a migration-created and a runtime-created table.
  const canonical = freshByKey.get(key);
  if (canonical) {
    const mine = shapeOf(db, obj);
    const theirs = shapeOf(freshDb, canonical);
    if (shapeKey(mine) !== shapeKey(theirs)) {
      console.error(
        `MIGRATION_SCHEMA_MISMATCH ${obj.type} ${obj.name} differs between migrations and the runtime:\n  migrations: ${shapeKey(theirs)}\n  runtime:     ${shapeKey(mine)}`,
      );
      mismatches += 1;
      failures += 1;
    }
  }
  if (obj.type === "table" && !declared.has(obj.name)) {
    console.error(
      `PRISMA_MODEL_MISSING ${obj.name}; model runtime-managed tables explicitly with @@ignore.`,
    );
    failures += 1;
  }
}
for (const [key, obj] of beforeByKey) {
  if (!runtimeObjects.has(key)) {
    console.error(
      `RUNTIME_SCHEMA_DRIFT ${obj.type} ${obj.name} was removed by runtime bootstrap; migrations and runtime disagree.`,
    );
    failures += 1;
  }
}

runtime.close();
freshRuntime.close();
freshDb.close();
db.close();

const tables = after.filter((o) => o.type === "table").length;
const indexes = after.filter((o) => o.type === "index").length;
console.log(
  `checked ${tables} tables and ${indexes} indexes; ${failures} ownership errors${mismatches ? ` (${mismatches} definition mismatches)` : ""}; ${applied.length} migrations; scratch DB ${dbFile}`,
);
process.exitCode = failures ? 1 : 0;
