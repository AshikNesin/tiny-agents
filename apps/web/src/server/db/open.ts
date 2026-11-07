/**
 * The one way a Node process opens the app database: the server, `pnpm
 * db:migrate` and `pnpm seed` all come through here, so the production path
 * default, the migrations-folder lookup and the pre-Drizzle copy
 * (`legacy-copy.ts`) are decided once.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { uploadsRoot } from "@groot/core/storage/node";
import type { Database } from "@groot/core/database";
import { asCoreDatabase } from "./index";
import { openAppDatabase } from "./legacy-copy";
import { productionDataDir } from "../env";

/**
 * tiny-agents kept its database at /data/app.db in production before groot
 * 3.0 (whose default is /data/prod.db). Keep that path when DATABASE_URL is
 * unset, honouring `DATA_DIR` (default `/data`; see `productionDataDir()`).
 * Call before `bootstrap()` validates the environment.
 */
export function productionDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return `file:${productionDataDir(env)}/app.db`;
}

export function applyDatabaseDefaults(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === "production" && !env.DATABASE_URL)
    env.DATABASE_URL = productionDatabaseUrl(env);
}

/**
 * Migrations ship next to the server bundle in production (`<bundle>/drizzle`)
 * and live in apps/web/drizzle in the repo; `GROOT_MIGRATIONS_DIR` overrides.
 */
export function findMigrationsFolder(besideBundle?: string): string {
  const candidates = [
    process.env.GROOT_MIGRATIONS_DIR,
    besideBundle ? path.resolve(besideBundle, "drizzle") : undefined,
    path.resolve(process.cwd(), "apps/web/drizzle"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`Drizzle migrations folder not found. Looked in: ${candidates.join(", ")}`);
  }
  return found;
}

type ValidatedEnv = Parameters<typeof uploadsRoot>[0] & { DATABASE_URL: string };

/**
 * Open (and migrate) the database for `bootstrap()`. A database still in the
 * pre-Drizzle layout is copied into the new one first. `besideBundle` is the
 * server bundle's directory, where production builds keep the migrations.
 */
export function openNodeAppDatabase(
  validated: ValidatedEnv,
  options: { besideBundle?: string } = {},
): Database {
  return asCoreDatabase(
    openAppDatabase(validated.DATABASE_URL, {
      migrationsFolder: findMigrationsFolder(options.besideBundle),
      uploadsRoot: uploadsRoot(validated),
    }),
  );
}
