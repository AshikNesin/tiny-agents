import { createServer } from "node:net";
import { afterAll, expect, it, vi } from "vite-plus/test";
import { installAppForTests } from "../../../../apps/web/src/server/app-root";

const server = createServer();
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

it("stubs, installs and closes what it opens", async () => {
  vi.stubEnv("ISOLATION_PROBE_STUB", "1");
  vi.stubGlobal("isolationProbeStub", true);
  vi.useFakeTimers();
  setTimeout(() => {}, 60_000);
  installAppForTests({ runtimeReady: true });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  expect(process.env.ISOLATION_PROBE_STUB).toBe("1");
});
