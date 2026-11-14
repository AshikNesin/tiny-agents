/**
 * Characterization of behavior-register row U11: browser screenshots are
 * allowed while the owner drives; computer screenshots are refused.
 * Preserve: this pins today's behavior, quirk included; change it only with
 * a signed-off register row.
 */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi, ToolExecutionResult } from "@earendil-works/pi-durable";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { Capability } from "../../../packages/agent/src/capabilities";
import {
  conversationBrowserTarget,
  createBrowserSessions,
  createBrowserToolkit,
  type BrowserSession,
  type BrowserSessions,
  type BrowserTransport,
} from "../../../packages/agent/src/toolkits/browser";
import {
  createComputerSessions,
  createComputerToolkit,
  type ComputerSessions,
} from "../../../packages/agent/src/toolkits/computer";
import { fakeComputer } from "../app/agent/computer-fakes";

const CONVERSATION = "4242";

async function run(capability: Capability, name: string, args: Record<string, unknown> = {}) {
  const tool = capability.extension.tools!.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  const api = {
    conversationId: CONVERSATION,
    taskId: "1",
    memo: async (_key: string, value: unknown) => value,
    snapshot: async () => null,
    details: async () => undefined,
  } as unknown as ToolExecutionApi;
  const result = (await tool.execute(
    args as never,
    api,
    BACKGROUND_CONTEXT,
  )) as ToolExecutionResult;
  const text = (result.output ?? []).map((b) => (b.type === "text" ? b.text : "")).join("");
  const images = (result.output ?? []).filter((b) => b.type === "image");
  return { ...result, text, images };
}

/** A browser that answers every call; it records the screenshots it takes. */
function fakeBrowser() {
  const shots: number[] = [];
  const transport: BrowserTransport = async () =>
    ({
      onDisconnect: () => undefined,
      url: () => "https://example.com/",
      adoptActiveTab: async () => undefined,
      navigate: async (url: string) => ({ url, status: 200 }),
      snapshot: async () => "- body [ref=e1]",
      click: async () => ({ url: "https://example.com/" }),
      type: async () => ({ url: "https://example.com/" }),
      press: async () => undefined,
      scroll: async () => undefined,
      screenshot: async () => {
        shots.push(shots.length + 1);
        return { data: "anBnZGF0YQ==" };
      },
      close: async () => undefined,
    }) satisfies BrowserSession;
  return { transport, shots };
}

let browsers: BrowserSessions | undefined;
let computers: ComputerSessions | undefined;
afterEach(async () => {
  await browsers?.closeAll();
  await computers?.closeAll();
  browsers = undefined;
  computers = undefined;
});

describe("U11: screenshots while the owner drives", () => {
  it("the browser takes one; the computer refuses", async () => {
    // Browser: the owner takes the wheel of the conversation's browser.
    const browser = fakeBrowser();
    browsers = createBrowserSessions({
      transport: browser.transport,
      profilesDir: "/tmp/ta-characterization-u11",
    });
    const browserTools = createBrowserToolkit({
      transport: browser.transport,
      profilesDir: "/tmp/ta-characterization-u11",
      sessions: browsers,
    });
    await run(browserTools, "browser_snapshot");
    const target = conversationBrowserTarget(Number(CONVERSATION));
    await browsers.setDriver(target, "human");
    expect(browsers.get(target)?.driver).toBe("human");

    const browserShot = await run(browserTools, "browser_screenshot");
    expect(browserShot.isError).toBeUndefined();
    expect(browserShot.text).toBe("Screenshot captured as an attachment.");
    expect(browserShot.images).toHaveLength(1);
    expect(browser.shots).toEqual([1]);

    // Computer: the owner takes the wheel of the shared desktop.
    const fake = fakeComputer();
    computers = createComputerSessions({ transport: fake.transport });
    const computerTools = createComputerToolkit({ sessions: computers, settleMs: 0 });
    await computers.acquire("shared");
    await computers.setDriver("shared", "human");

    const computerShot = await run(computerTools, "computer_screenshot");
    expect(computerShot.isError).toBe(true);
    expect(computerShot.text).toBe(
      "The owner is driving the computer, so screenshots are paused. Wait for them to hand it back, or continue without the computer.",
    );
    expect(computerShot.images).toEqual([]);
    expect(fake.log.filter((entry) => entry.method === "screenshot")).toEqual([]);
  });
});
