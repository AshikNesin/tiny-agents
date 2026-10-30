import { eq } from "drizzle-orm";
import { bootstrap } from "@groot/core/bootstrap";
import { db, users } from "@groot/core/database";
import { hashPassword } from "@groot/core/utils/password.utils";
import { asCoreDatabase } from "../../apps/web/src/server/db";
import { openAppDatabase } from "../../apps/web/src/server/db/legacy-copy";

const SEED_USER = {
  email: "demo@example.com",
  password: "demo@example.com",
  name: "Demo User",
};

/**
 * Make sure the e2e login user exists. The dev server started by Playwright's
 * webServer uses the same DATABASE_URL, so the user is visible to it.
 */
async function globalSetup() {
  bootstrap({
    env: process.env,
    config: { jobs: { enabled: false }, logging: { level: "warn" } },
    db: (env) =>
      asCoreDatabase(openAppDatabase(env.DATABASE_URL, { migrationsFolder: "apps/web/drizzle" })),
  });
  const [existing] = await db.select().from(users).where(eq(users.email, SEED_USER.email)).limit(1);
  if (!existing) {
    await db.insert(users).values({
      email: SEED_USER.email,
      name: SEED_USER.name,
      password: await hashPassword(SEED_USER.password),
    });
  }
  console.log("E2E seed: test user ready");
}

export default globalSetup;
