/**
 * The dev server for a verify run that swaps something in before boot:
 * `--fake-github` (fake-github-entry.ts) and `--demo-agent` (demo-agent.ts).
 * Each installs its fakes on the App root, then the real entry starts.
 */
import { installAppForTests } from "../../../../apps/web/src/server/app-root";

if (process.env.TA_VERIFY_FAKE_GITHUB) await import("./fake-github-entry.ts");
if (process.env.TA_VERIFY_DEMO_AGENT) {
  const { createDemoAgent } = await import("./demo-agent.ts");
  installAppForTests({ codeHarnesses: [createDemoAgent()] });
}

await import("../../../../apps/web/src/server/entry.node.ts");
