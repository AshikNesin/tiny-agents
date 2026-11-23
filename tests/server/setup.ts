import { bootstrap } from "@groot/core/bootstrap";
import { memoryStorage } from "@groot/core/storage/memory";
import { guardFileIsolation } from "./fixtures/file-isolation";
import { closeTestDatabase, freshTestDatabase } from "./fixtures/test-db";
import { pinClockWhileLoadingAndBeforeEachTest } from "../test-clock";
import { boundWaitsByTestTimeout } from "./fixtures/until";

pinClockWhileLoadingAndBeforeEachTest();
boundWaitsByTestTimeout();

process.env.NODE_ENV = "test";
process.env.SECRETS_KEY ??= "dGVzdC1vbmx5LXNlY3JldHMta2V5LW5vdC1mb3ItcHJvZHVjdGlvbg";

const seedModels = async () => {
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
};

await freshTestDatabase(
  (db) =>
    bootstrap({
      env: { ...process.env, NODE_ENV: "test", DATABASE_URL: ":memory:" },
      config: { jobs: { enabled: false }, logging: { level: "silent" } },
      db,
      storage: memoryStorage(),
    }),
  seedModels,
);

const { setExtractRunner } =
  await import("../../apps/web/src/server/api/uploads/uploads.extraction");
const { inProcessRunner } =
  await import("../../apps/web/src/server/api/uploads/uploads.extract-runner");
setExtractRunner(inProcessRunner);

guardFileIsolation(closeTestDatabase);
