import { bootstrap } from "@groot/core/bootstrap";
import { memoryStorage } from "@groot/core/storage/memory";
import { asCoreDatabase, createAppDb } from "../../apps/web/src/server/db";
import { pinClockWhileLoadingAndBeforeEachTest } from "../test-clock";
import { boundWaitsByTestTimeout } from "./fixtures/until";

pinClockWhileLoadingAndBeforeEachTest();
boundWaitsByTestTimeout();

process.env.NODE_ENV = "test";
process.env.SECRETS_KEY ??= "test-only-secrets-key-not-for-production";

bootstrap({
  env: { ...process.env, NODE_ENV: "test", DATABASE_URL: ":memory:" },
  config: { jobs: { enabled: false }, logging: { level: "silent" } },
  db: asCoreDatabase(createAppDb(":memory:", { migrationsFolder: "apps/web/drizzle" })),
  storage: memoryStorage(),
});

const { seedFauxModels } = await import("../../apps/web/src/server/api/models/models.config");
await seedFauxModels(
  [
    ["test-model", "Test Model"],
    ["test-model-2", "Test Model 2"],
    ["m", "M"],
    ["m1", "M1"],
    ["m2", "M2"],
    ["m-1", "M 1"],
    ["m-2", "M 2"],
    ["known-model", "Known Model"],
    ["vision-model", "Vision Model"],
    ["text-model", "Text Model"],
    ["bot-model", "Bot Model"],
  ].map(([id, name]) => ({ id: id!, name: name!, imageInput: id === "vision-model" })),
);
