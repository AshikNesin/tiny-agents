/**
 * Characterization of behavior-register row C17: the Code harness set is
 * fixed at boot, so turning the Claude plan on later needs a restart.
 * Preserve: this pins today's behavior, quirk included; change it only with
 * a signed-off register row.
 */
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { ClaudeWorkerLocator } from "@tiny-agents/agent/claude-worker";
import { startCode } from "../../../apps/web/src/server/api/code/code.boot";
import { buildHarnesses } from "../../../apps/web/src/server/api/code/code.registry";
import { codeHub } from "../../../apps/web/src/server/api/code/code.hub";
import type { BotConversationRuntime } from "../../../apps/web/src/server/api/bots/bots.conversation";
import { api, createTestApp } from "../helpers";
import { authToken, installFakeRuntime } from "../fixtures";

// A sandbox is configured: the shared worker locator exists, signed in, never reached.
vi.mock("../../../apps/web/src/server/api/bots/claude-worker", () => {
  const locator = {
    mode: "sandbox",
    resolve: () => new Promise(() => undefined),
    prepare: () => undefined,
    account: async () => ({ state: "ready", subscription: "pro" }),
    close: () => undefined,
  } as unknown as ClaudeWorkerLocator;
  return { sharedClaudeWorkerLocator: () => locator };
});

const token = await authToken("c17-owner@example.com");
const app = createTestApp();
let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
});

const statusIds = async () =>
  (
    await api<{ harnesses: { id: string }[] }>(app, "/api/v1/code/status", { token })
  ).body.data!.harnesses.map((harness) => harness.id);

describe("C17: the Claude plan turned on after boot", () => {
  it("adds no Claude Code harness until the next boot builds the set again", async () => {
    const fake = installFakeRuntime();
    fake.catalog.claudePlan.mockReturnValue({ enabled: false });

    // Boot with the Claude plan off: no harness at all (no SHELLEY_URL in tests).
    stop = startCode(fake as unknown as BotConversationRuntime);
    expect(
      codeHub()
        ?.instances()
        .map((instance) => instance.id),
    ).toEqual([]);
    expect(await statusIds()).toEqual([]);

    // The owner turns the Claude plan on (Settings → Models). Nothing rebuilds the set.
    fake.catalog.claudePlan.mockReturnValue({ enabled: true });
    expect(
      codeHub()
        ?.instances()
        .map((instance) => instance.id),
    ).toEqual([]);
    expect(await statusIds()).toEqual([]);

    // Only a fresh build (what a restart does) sees it.
    expect(buildHarnesses().map((instance) => instance.id)).toEqual(["claude-code"]);
    stop();
    stop = startCode(fake as unknown as BotConversationRuntime);
    expect(await statusIds()).toEqual(["claude-code"]);
  });
});
