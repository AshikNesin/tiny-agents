#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import { bootstrap } from "@groot/core/bootstrap";
import { env } from "@groot/core/env";
import { applyDatabaseDefaults, openNodeAppDatabase } from "../apps/web/src/server/db/open";

if (existsSync(".env")) process.loadEnvFile(".env");
applyDatabaseDefaults();
bootstrap({
  env: process.env,
  config: { logging: { level: "warn" } },
  db: (validated) => openNodeAppDatabase(validated),
});
console.log(`✓ Migrations applied to ${env.DATABASE_URL}`);
