#!/usr/bin/env tsx
/**
 * Seed the local database with the demo user. Idempotent. The task list
 * starts empty (tasks replace groot's demo todos). A pre-Drizzle database is
 * copied into the new layout first, as the server would on boot.
 */
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { eq } from "drizzle-orm";
import { bootstrap } from "@groot/core/bootstrap";
import { db, users } from "@groot/core/database";
import { uploadsRoot } from "@groot/core/storage/node";
import { hashPassword } from "@groot/core/utils/password.utils";
import { asCoreDatabase } from "../apps/web/src/server/db";
import { openAppDatabase } from "../apps/web/src/server/db/legacy-copy";

export const SEED_USER = {
  email: "demo@example.com",
  password: "demo@example.com",
  name: "Demo User",
};

/** Boot against `DATABASE_URL` (migrations applied) and make sure the demo data exists. */
export async function seed(): Promise<void> {
  bootstrap({
    env: process.env,
    config: { logging: { level: "warn" } },
    db: (env) =>
      asCoreDatabase(
        openAppDatabase(env.DATABASE_URL, {
          migrationsFolder: "apps/web/drizzle",
          uploadsRoot: uploadsRoot(env),
        }),
      ),
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
