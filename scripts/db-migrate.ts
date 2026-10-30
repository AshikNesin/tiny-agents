#!/usr/bin/env tsx
/**
 * Apply pending Drizzle migrations to the local SQLite database. The Node
 * server also does this on boot; this script is for CI, scripts and one-off
 * runs. A database still in the pre-Drizzle (Prisma) layout is copied into the
 * new layout first, exactly as the server would on boot.
 */
import { bootstrap } from "@groot/core/bootstrap";
import { env } from "@groot/core/env";
import { uploadsRoot } from "@groot/core/storage/node";
import { asCoreDatabase } from "../apps/web/src/server/db";
import { openAppDatabase } from "../apps/web/src/server/db/legacy-copy";

bootstrap({
  env: process.env,
  config: { logging: { level: "warn" } },
  db: (validated) =>
    asCoreDatabase(
      openAppDatabase(validated.DATABASE_URL, {
        migrationsFolder: "apps/web/drizzle",
        uploadsRoot: uploadsRoot(validated),
      }),
    ),
});
console.log(`✓ Migrations applied to ${env.DATABASE_URL}`);
