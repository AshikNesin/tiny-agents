import { existsSync } from "node:fs";
import path from "node:path";
import { uploadsRoot } from "@groot/core/storage/node";
import type { Database } from "@groot/core/database";
import { asCoreDatabase } from "./index";
import { openAppDatabase } from "./legacy-copy";
import { productionDataDir } from "../env";

export function productionDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return `file:${productionDataDir(env)}/app.db`;
}

export function applyDatabaseDefaults(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === "production" && !env.DATABASE_URL)
    env.DATABASE_URL = productionDatabaseUrl(env);
}

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
