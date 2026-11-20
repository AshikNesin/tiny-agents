#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { eq } from "drizzle-orm";
import { bootstrap } from "@groot/core/bootstrap";
import { db, users } from "@groot/core/database";
import { hashPassword } from "@groot/core/utils/password.utils";
import { applyDatabaseDefaults, openNodeAppDatabase } from "../apps/web/src/server/db/open";
import { installFixedClock } from "../apps/web/src/server/fixed-clock";

export const SEED_USER = {
  email: "demo@example.com",
  password: "demo@example.com", // gitleaks:allow
  name: "Demo User",
};

export async function seed(): Promise<void> {
  installFixedClock(process.env);
  applyDatabaseDefaults();
  bootstrap({
    env: process.env,
    config: { logging: { level: "warn" } },
    db: (validated) => openNodeAppDatabase(validated),
  });

  const [existing] = await db.select().from(users).where(eq(users.email, SEED_USER.email)).limit(1);
  if (existing) {
    console.log("   Seed user already exists");
  } else {
    await db.insert(users).values({
      email: SEED_USER.email,
      name: SEED_USER.name,
      password: await hashPassword(SEED_USER.password),
    });
    console.log("   ✅ Seed user created");
  }
  console.log(`   📧 Email:    ${SEED_USER.email}`);
  console.log(`   🔑 Password: ${SEED_USER.password}`);
  console.log("   📝 Task list starts empty (tasks replace demo todos)");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (existsSync(".env")) process.loadEnvFile(".env");
  seed().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
