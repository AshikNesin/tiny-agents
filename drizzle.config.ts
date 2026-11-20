import { defineConfig } from "drizzle-kit";
import { defaultDatabaseUrl } from "@groot/core/env";

const url = (process.env.DATABASE_URL || defaultDatabaseUrl(process.env.NODE_ENV)).replace(
  /^file:/,
  "",
);

export default defineConfig({
  dialect: "sqlite",
  schema: "./apps/web/src/server/db/schema.ts",
  out: "./apps/web/drizzle",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
