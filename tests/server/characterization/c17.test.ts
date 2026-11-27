import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { ClaudeWorkerLocator } from "@tiny-agents/agent/claude-worker";
import { startCode } from "../../../apps/web/src/server/api/code/code.boot";
import { buildHarnesses } from "../../../apps/web/src/server/api/code/code.registry";
import { codeHub } from "../../../apps/web/src/server/api/code/code.hub";
import type { DeliveryRuntime } from "../../../apps/web/src/server/api/bots/bots.delivery";
import { api, createTestApp } from "../helpers";
import { authToken, installFakeRuntime } from "../fixtures";

const signIn = vi.hoisted(() => ({ reads: 0 }));

vi.mock("../../../apps/web/src/server/api/bots/claude-worker", () => {
  const locator = {
    mode: "sandbox",
    resolve: () => new Promise(() => undefined),
    prepare: () => undefined,
    account: async () => {
      signIn.reads += 1;
      return { state: "ready" };
    },
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

    stop = startCode(fake as unknown as DeliveryRuntime);
    expect(
      codeHub()
        ?.instances()
        .map((instance) => instance.id),
    ).toEqual([]);
    expect(await statusIds()).toEqual([]);

    fake.catalog.claudePlan.mockReturnValue({ enabled: true });
    expect(
      codeHub()
        ?.instances()
        .map((instance) => instance.id),
    ).toEqual([]);
    expect(await statusIds()).toEqual([]);

    expect(buildHarnesses().map((instance) => instance.id)).toEqual(["claude-code"]);
    stop();
    stop = startCode(fake as unknown as DeliveryRuntime);
    expect(await statusIds()).toEqual(["claude-code"]);
  });
});

describe("Claude Code sign-in status", () => {
  it("is read only while the harness runs, and shows the sign-in hint", async () => {
    const fake = installFakeRuntime();
    fake.catalog.claudePlan.mockReturnValue({ enabled: true });
    signIn.reads = 0;

    const [harness] = buildHarnesses();
    expect(signIn.reads).toBe(0);

    harness!.start();
    await vi.waitFor(() => expect(harness!.status().state).toBe("reconnecting"));
    expect(harness!.status().detail).toBe(
      "Sign Claude Code in: Settings → Models → Claude plan → Sign in.",
    );
    harness!.stop();
    expect(signIn.reads).toBe(1);
  });
});
