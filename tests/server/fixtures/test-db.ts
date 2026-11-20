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

/**
 * A fresh database for one test file: a copy of the worker's image, which
 * `seed` fills the first time (with the template installed as the app's
 * database, so `seed` can use the app's own services).
 */
export async function freshTestDatabase(
  install: (db: Database) => void,
  seed: () => Promise<void>,
): Promise<AppDatabase> {
  if (!image) {
    const template = createAppDb(":memory:", { migrationsFolder: "apps/web/drizzle" });
    install(asCoreDatabase(template));
    await seed();
    image = sqliteConnection(template).serialize();
    sqliteConnection(template).close();
  }
  const copy = createAppDb(":memory:", { image });
  install(asCoreDatabase(copy));
  return copy;
}
