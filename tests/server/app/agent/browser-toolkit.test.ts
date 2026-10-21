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
  browserOpenState,
  closeBrowserSession,
  createBrowserToolkit,
  getLiveBrowserSession,
  isBlockedPrivateUrl,
  resetBrowserSessionsForTests,
  setDriver,
  startBrowserSession,
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
      adoptActiveTab: async () => {
        log.push({ method: "adoptActiveTab" });
      },
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

  it("navigate waits while the human drives (takeover covers navigation)", async () => {
    const { transport, log } = fakeTransport();
    const tk = createBrowserToolkit({
      transport,
      profilesDir: "/tmp/ta-test-profiles",
      humanDriverWaitMs: 1500,
    });
    // A session must exist before takeover can be claimed (the routes
    // requireSession first); create it, then flip the driver.
    await run(tk, "browser_snapshot", {});
    setDriver(4242, "human");
    const pending = run(tk, "browser_navigate", { url: "https://example.com/" });
    await new Promise((r) => setTimeout(r, 300));
    expect(log.filter((e) => e.method === "navigate")).toHaveLength(0);
    setDriver(4242, "agent");
    const done = await pending;
    expect(done.isError).toBeUndefined();
  });

  it("closeBrowserSession removes the session so the next call reopens", async () => {
    const { transport, log } = fakeTransport();
    const tk = createBrowserToolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });
    await run(tk, "browser_navigate", { url: "https://example.com/" });
    expect(getLiveBrowserSession(4242)).toBeDefined();
    await closeBrowserSession(4242);
    expect(getLiveBrowserSession(4242)).toBeUndefined();
    expect(log.some((e) => e.method === "close")).toBe(true);
    // The next navigate opens a fresh session (a second transport dial).
    const dials = log.filter((e) => e.method === "navigate").length;
    await run(tk, "browser_navigate", { url: "https://example.com/2" });
    expect(log.filter((e) => e.method === "navigate").length).toBeGreaterThan(dials);
  });

  it("isBlockedPrivateUrl knows exemptions", () => {
    expect(isBlockedPrivateUrl("https://example.com/")).toBe(false);
    expect(isBlockedPrivateUrl("http://localhost:1/")).toBe(true);
    expect(isBlockedPrivateUrl("http://localhost:1/", "localhost")).toBe(false);
    expect(isBlockedPrivateUrl("http://127.0.0.1:1/", "localhost")).toBe(true);
  });

  it("releasing control makes the agent adopt the tab the owner left in front", async () => {
    const { transport, log } = fakeTransport();
    const tk = createBrowserToolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });
    await run(tk, "browser_snapshot", {});
    await setDriver(4242, "agent"); // already the agent: nothing to adopt
    expect(log.filter((e) => e.method === "adoptActiveTab")).toHaveLength(0);
    await setDriver(4242, "human");
    expect(log.filter((e) => e.method === "adoptActiveTab")).toHaveLength(0);
    await setDriver(4242, "agent");
    expect(log.filter((e) => e.method === "adoptActiveTab")).toHaveLength(1);
    expect(getLiveBrowserSession(4242)?.driver).toBe("agent");
  });

  it("an owner-started open and a tool call share one launch and report the phase", async () => {
    const { transport: inner, log } = fakeTransport();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let dials = 0;
    const transport: BrowserTransport = async (dir, open) => {
      dials += 1;
      open.onPhase?.("installing");
      await gate;
      return inner(dir, open);
    };
    const tk = createBrowserToolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });

    const started = startBrowserSession(4242);
    const tool = run(tk, "browser_snapshot", {});
    await new Promise((r) => setTimeout(r, 20));
    expect(browserOpenState(4242)).toEqual({ opening: true, phase: "installing" });
    expect(getLiveBrowserSession(4242)).toBeUndefined();

    release();
    await started;
    await tool;
    expect(dials).toBe(1);
    expect(log.filter((e) => e.method === "snapshot")).toHaveLength(1);
    expect(browserOpenState(4242)).toEqual({ opening: false, error: undefined });
    expect(getLiveBrowserSession(4242)).toBeDefined();
  });

  it("remembers why the last open failed until the next attempt", async () => {
    createBrowserToolkit({
      transport: async () => {
        throw new Error("VM exec failed: no sudo");
      },
      profilesDir: "/tmp/ta-test-profiles",
    });
    await expect(startBrowserSession(4242)).rejects.toThrow("no sudo");
    const failed = browserOpenState(4242);
    expect(failed.opening).toBe(false);
    expect(failed.opening === false && failed.error).toContain("no sudo");

    const { transport } = fakeTransport();
    createBrowserToolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });
    await startBrowserSession(4242);
    expect(browserOpenState(4242)).toEqual({ opening: false, error: undefined });
  });
});
