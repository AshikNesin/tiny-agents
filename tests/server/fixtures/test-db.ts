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

export async function useFreshTestDatabase(): Promise<void> {
  const { app, resetAppForTests } = await import("../../../apps/web/src/server/app-root");
  if (app().runtime) {
    throw new Error("useFreshTestDatabase: close the runtime this test file opened first");
  }
  resetAppForTests();
  openCopy();
}

export function closeTestDatabase(): void {
  if (current) {
    const sqlite = sqliteConnection(current);
    if (sqlite.open) sqlite.close();
  }
  current = undefined;
}
