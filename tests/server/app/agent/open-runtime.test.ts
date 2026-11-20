import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  closeAgentRuntime,
  openAgentRuntime,
} from "../../../../apps/web/src/server/api/bots/bots.runtime";

const dirs: string[] = [];

afterEach(async () => {
  await closeAgentRuntime().catch(() => undefined);
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("openAgentRuntime (production shape)", () => {
  it("boots without a passed model registry and installs the vision toolkit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-runtime-"));
    dirs.push(dir);
    const runtime = await openAgentRuntime({
      storePath: join(dir, "agent.db"),
      env: process.env,
      onFatal: () => undefined,
      onReport: () => undefined,
    });
    const toolkits = runtime.listCapabilities().filter((c) => c.kind === "toolkit");
    expect(toolkits.map((t) => t.id)).toContain("vision");
    expect(runtime.catalog.list().length).toBeGreaterThan(0);
    await runtime.close();
  }, 20_000);
});
