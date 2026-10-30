#!/usr/bin/env tsx
/**
 * Apply pending Drizzle migrations to the local SQLite database.
 * The Node server also does this on boot; this script is for CI, scripts and
 * one-off runs. For Cloudflare D1 use `pnpm db:migrate:worker`.
 */
import { createSqliteDb } from "@groot/core/database/node";
import { defaultDatabaseUrl } from "@groot/core/env";

const url = process.env.DATABASE_URL || defaultDatabaseUrl(process.env.NODE_ENV);
createSqliteDb(url, { migrationsFolder: "apps/web/drizzle" });
console.log(`✓ Migrations applied to ${url}`);
