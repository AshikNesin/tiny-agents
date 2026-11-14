#!/usr/bin/env tsx
/**
 * Re-seal every secret the app stores (local vault items and connection
 * OAuth state) under the current SECRETS_KEY. Run after moving the old key to
 * SECRETS_KEY_PREVIOUS and setting a new SECRETS_KEY; once it reports done,
 * SECRETS_KEY_PREVIOUS can be removed. Secrets an older version left in the
 * KV store or on a connection are moved into the vault first, as a start
 * would. See docs/features/vault.md.
 */
import { existsSync } from "node:fs";
import { bootstrap } from "@groot/core/bootstrap";
import { applyDatabaseDefaults, openNodeAppDatabase } from "../apps/web/src/server/db/open";
import { resealConnectionSecrets } from "../apps/web/src/server/api/connections/connection-secrets";
import { resealLocalItems } from "../apps/web/src/server/api/vault/backends/local";
import { importStoredSecrets } from "../apps/web/src/server/api/vault/vault.import";

if (existsSync(".env")) process.loadEnvFile(".env");
if (!process.env.SECRETS_KEY?.trim()) {
  console.error("✗ Set SECRETS_KEY (the new key) and SECRETS_KEY_PREVIOUS (the old one) first.");
  process.exit(1);
}
applyDatabaseDefaults();
bootstrap({
  env: process.env,
  config: { logging: { level: "warn" } },
  db: (validated) => openNodeAppDatabase(validated),
});
importStoredSecrets();
const vault = resealLocalItems();
const connections = await resealConnectionSecrets();
console.log(
  `✓ Re-sealed ${vault} local vault item(s) and ${connections} connection secret(s). ` +
    "You can now remove SECRETS_KEY_PREVIOUS.",
);
