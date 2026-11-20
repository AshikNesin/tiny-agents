/**
 * One migrated, seeded database per worker. The server setup builds it the
 * first time a file in the worker runs, keeps it as a serialized image, and
 * opens a fresh in-memory copy of it for every test file. Migrating takes
 * ~15 ms; the copy takes well under one.
 *
 * The image lives in this module, so it is built once per worker only where
 * modules are shared between files (the `server` project, `isolate: false`).
 * An isolated file builds its own.
 */
import {
  asCoreDatabase,
  createAppDb,
  sqliteConnection,
  type AppDatabase,
} from "../../../apps/web/src/server/db";
import type { Database } from "@groot/core/database";

let image: Buffer | undefined;
let install: ((db: Database) => void) | undefined;
let current: AppDatabase | undefined;

function openCopy(): AppDatabase {
  closeTestDatabase();
  current = createAppDb(":memory:", { image: image! });
  install!(asCoreDatabase(current));
  return current;
}

/**
 * A fresh database for one test file: a copy of the worker's image, which
 * `seed` fills the first time (with the template installed as the app's
 * database, so `seed` can use the app's own services). The server setup
 * calls it before every file.
 */
export async function freshTestDatabase(
  installDatabase: (db: Database) => void,
  seed: () => Promise<void>,
): Promise<AppDatabase> {
  install = installDatabase;
  if (!image) {
    const template = createAppDb(":memory:", { migrationsFolder: "apps/web/drizzle" });
    install(asCoreDatabase(template));
    await seed();
    image = sqliteConnection(template).serialize();
    sqliteConnection(template).close();
  }
  return openCopy();
}

/**
 * Start this test the way a new file starts: a new copy of the seeded
 * database (row ids and autoincrement counters start over) and an empty App
 * root. Call it first in `beforeEach`, before the test opens anything, when a
 * test records ids (the golden traces) or reads whole tables. Anything keyed
 * to the old database (an open runtime's stores, a token from `authToken`)
 * must be made again. Throws if a runtime is still installed: close it first.
 */
export async function useFreshTestDatabase(): Promise<void> {
  // Loaded here, not at the top: the setup imports this module before a
  // file's vi.mock calls run.
  const { app, resetAppForTests } = await import("../../../apps/web/src/server/app-root");
  if (app().runtime) {
    throw new Error("useFreshTestDatabase: close the runtime this test file opened first");
  }
  resetAppForTests();
  openCopy();
}

/** Close the current copy (the setup does, after every file). */
export function closeTestDatabase(): void {
  if (current) {
    const sqlite = sqliteConnection(current);
    if (sqlite.open) sqlite.close();
  }
  current = undefined;
}
