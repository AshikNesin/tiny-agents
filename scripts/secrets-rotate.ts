#!/usr/bin/env tsx
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
const done = `Re-sealed ${vault.resealed} local vault item(s) and ${connections} connection secret(s).`;
if (vault.skipped.length > 0) {
  console.error(
    `✗ ${done} ${vault.skipped.length} vault item(s) couldn't be read and were left as they ` +
      `were (${vault.skipped.join(", ")}); keep SECRETS_KEY_PREVIOUS until they are ` +
      "re-entered or deleted in the Vault, then run this again.",
  );
  process.exit(1);
}
console.log(`✓ ${done} You can now remove SECRETS_KEY_PREVIOUS.`);
