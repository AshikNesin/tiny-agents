/**
 * The browser toolkit (issue #24): unit tests against a fake transport.
 * The real Chromium path is smoke-tested in /tmp scripts during development
 * and by the live e2e; here we verify the port contract, gating, driver
 * arbitration, URL rules, and the never-echo-typed-secrets rule.
 */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi, ToolExecutionResult } from "@earendil-works/pi-durable";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  createBrowserToolkit,
  getLiveBrowserSession,
  resetBrowserSessionsForTests,
  setDriver,
  type BrowserInput,
  type BrowserSession,
  type BrowserTransport,
} from "../../../../packages/agent/src/toolkits/browser";
import type { Capability } from "../../../../packages/agent/src/capabilities";

async function run(capability: Capability, name: string, args: Record<string, unknown>) {
  const tool = capability.extension.tools!.find((t) => t.name === name)!;
  const result = (await tool.execute(
    args as never,
    { conversationId: "4242" } as ToolExecutionApi,
    BACKGROUND_CONTEXT,
  )) as ToolExecutionResult;
  const text = (result.output ?? []).map((b) => (b.type === "text" ? b.text : "")).join("");
  return { ...result, text };
}

function fakeTransport() {
  const log: { method: string; args?: unknown }[] = [];
  let url = "about:blank";
  let snapshotText = '- body [ref=e1]\n  - input [ref=e2]\n  - button "Go" [ref=e3]';
  const transport: BrowserTransport = async () => {
    const session: BrowserSession = {
      url: () => url,
      on: () => () => {},
      navigate: async (next) => {
        log.push({ method: "navigate", args: next });
        url = next;
        return { url: next, status: 200 };
      },
      snapshot: async () => {
        log.push({ method: "snapshot" });
        return snapshotText;
      },
      click: async (ref) => {
        log.push({ method: "click", args: ref });
        return { url };
      },
      type: async (ref, text) => {
        log.push({ method: "type", args: { ref, text } });
        return { url };
      },
      press: async (key) => {
        log.push({ method: "press", args: key });
      },
      scroll: async (direction, amount) => {
        log.push({ method: "scroll", args: { direction, amount } });
      },
      screenshot: async () => {
        log.push({ method: "screenshot" });
        return { data: "anBnZGF0YQ==" };
      },
      input: async (event: BrowserInput) => {
        log.push({ method: "input", args: event });
      },
      startScreencast: async () => {
        log.push({ method: "startScreencast" });
      },
      stopScreencast: async () => {
        log.push({ method: "stopScreencast" });
      },
      close: async () => {
        log.push({ method: "close" });
      },
    };
    return session;
  };
  return {
    transport,
    log,
    setSnapshot: (t: string) => (snapshotText = t),
    get url() {
      return url;
    },
  };
}

describe("browser toolkit", () => {
  // The session map is module-level (one per server process); tests must not
  // inherit each other's fake transports.
  beforeEach(() => {
    resetBrowserSessionsForTests();
  });

  it("navigates and returns status + final url", async () => {
    const { transport } = fakeTransport();
    const tk = createBrowserToolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });
    const r = await run(tk, "browser_navigate", { url: "https://example.com/" });
    expect(r.isError).toBeUndefined();
    expect(r.text).toContain("200");
    expect(r.text).toContain("example.com");
  });

  it("refuses private hosts unless exempted", async () => {
    const { transport } = fakeTransport();
    const tk = createBrowserToolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });
    const denied = await run(tk, "browser_navigate", { url: "http://127.0.0.1:8080/" });
    expect(denied.isError).toBe(true);
    expect(denied.text).toContain("Private");

    const ok = createBrowserToolkit({
      transport,
      profilesDir: "/tmp/ta-test-profiles",
      allowedPrivateHosts: "localhost, git.internal",
    });
    const allowed = await run(ok, "browser_navigate", { url: "http://localhost:9988/" });
    expect(allowed.isError).toBeUndefined();

    const other = await run(ok, "browser_navigate", { url: "http://192.168.1.5/" });
    expect(other.isError).toBe(true);
  });

  it("refuses non-http and credential URLs", async () => {
    const { transport } = fakeTransport();
    const tk = createBrowserToolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });
    expect((await run(tk, "browser_navigate", { url: "file:///etc/passwd" })).isError).toBe(true);
    expect((await run(tk, "browser_navigate", { url: "https://u:p@example.com/" })).isError).toBe(
      true,
    );
    expect((await run(tk, "browser_navigate", { url: "javascript:alert(1)" })).isError).toBe(true);
  });

  it("clicks by ref from a snapshot and never echoes typed text", async () => {
    const { transport, log } = fakeTransport();
    const tk = createBrowserToolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });
    const snap = await run(tk, "browser_snapshot", {});
    expect(snap.text).toContain("[ref=e2]");
    const typed = await run(tk, "browser_type", { ref: "e2", text: "hunter2" });
    expect(typed.isError).toBeUndefined();
    // The tool result must not contain the typed value (secrets discipline).
    expect(typed.text).not.toContain("hunter2");
    expect(log.some((e) => e.method === "type")).toBe(true);
    const clicked = await run(tk, "browser_click", { ref: "e3" });
    expect(clicked.text).toContain("e3");
  });

  it("invalid refs are rejected", async () => {
    const { transport } = fakeTransport();
    const tk = createBrowserToolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });
    const bad = await run(tk, "browser_click", { ref: "nope!" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("Invalid ref");
  });

  it("action tools wait while the human drives, then proceed after release", async () => {
    const { transport, log } = fakeTransport();
    const tk = createBrowserToolkit({
      transport,
      profilesDir: "/tmp/ta-test-profiles",
      humanDriverWaitMs: 1500,
    });
    await run(tk, "browser_navigate", { url: "https://example.com/" });
    setDriver(4242, "human");
    const pending = run(tk, "browser_click", { ref: "e3" });
    await new Promise((r) => setTimeout(r, 300));
    expect(log.filter((e) => e.method === "click")).toHaveLength(0); // still waiting
    setDriver(4242, "agent");
    const done = await pending;
    expect(done.isError).toBeUndefined();
    expect(log.filter((e) => e.method === "click")).toHaveLength(1);
  });

  it("human input goes through the same session (peer channel)", async () => {
    const { transport, log } = fakeTransport();
    const tk = createBrowserToolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });
    await run(tk, "browser_navigate", { url: "https://example.com/" });
    const live = getLiveBrowserSession(4242);
    expect(live).toBeDefined();
    await live!.session.input({ kind: "key", text: "s" });
    expect(log.some((e) => e.method === "input")).toBe(true);
  });
});
