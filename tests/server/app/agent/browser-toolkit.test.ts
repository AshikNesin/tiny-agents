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
  conversationBrowserTarget,
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

/** The default mapping: conversation 4242 gets a browser of its own. */
const TARGET = conversationBrowserTarget(4242);

async function run(
  capability: Capability,
  name: string,
  args: Record<string, unknown>,
  conversationId = "4242",
) {
  const tool = capability.extension.tools!.find((t) => t.name === name)!;
  const result = (await tool.execute(
    args as never,
    { conversationId } as ToolExecutionApi,
    BACKGROUND_CONTEXT,
  )) as ToolExecutionResult;
  const text = (result.output ?? []).map((b) => (b.type === "text" ? b.text : "")).join("");
  return { ...result, text };
}

function fakeTransport() {
  const log: { method: string; args?: unknown }[] = [];
  let url = "about:blank";
  let snapshotText = '- body [ref=e1]\n  - input [ref=e2]\n  - button "Go" [ref=e3]';
  /** One entry per session the transport opened: calling it reports that browser dead. */
  const deaths: (() => void)[] = [];
  const transport: BrowserTransport = async () => {
    const session: BrowserSession = {
      onDisconnect: (listener) => {
        deaths.push(listener);
      },
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
    deaths,
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
    setDriver(TARGET, "human");
    const pending = run(tk, "browser_click", { ref: "e3" });
    await new Promise((r) => setTimeout(r, 300));
    expect(log.filter((e) => e.method === "click")).toHaveLength(0); // still waiting
    setDriver(TARGET, "agent");
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
    setDriver(TARGET, "human");
    const pending = run(tk, "browser_navigate", { url: "https://example.com/" });
    await new Promise((r) => setTimeout(r, 300));
    expect(log.filter((e) => e.method === "navigate")).toHaveLength(0);
    setDriver(TARGET, "agent");
    const done = await pending;
    expect(done.isError).toBeUndefined();
  });

  it("closeBrowserSession removes the session so the next call reopens", async () => {
    const { transport, log } = fakeTransport();
    const tk = createBrowserToolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });
    await run(tk, "browser_navigate", { url: "https://example.com/" });
    expect(getLiveBrowserSession(TARGET)).toBeDefined();
    await closeBrowserSession(TARGET);
    expect(getLiveBrowserSession(TARGET)).toBeUndefined();
    expect(log.some((e) => e.method === "close")).toBe(true);
    // The next navigate opens a fresh session (a second transport dial).
    const dials = log.filter((e) => e.method === "navigate").length;
    await run(tk, "browser_navigate", { url: "https://example.com/2" });
    expect(log.filter((e) => e.method === "navigate").length).toBeGreaterThan(dials);
  });

  it("drops a browser that died so the next call opens a fresh one", async () => {
    const { transport, log, deaths } = fakeTransport();
    const tk = createBrowserToolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });
    await run(tk, "browser_navigate", { url: "https://example.com/" });
    expect(getLiveBrowserSession(TARGET)).toBeDefined();
    expect(deaths).toHaveLength(1);

    deaths[0]!(); // the link to the browser dropped
    expect(getLiveBrowserSession(TARGET)).toBeUndefined();
    // The dead session is torn down (the remote processes must not leak) ...
    expect(log.filter((e) => e.method === "close")).toHaveLength(1);
    // ... and the next tool call starts over instead of failing on a corpse.
    const next = await run(tk, "browser_navigate", { url: "https://example.com/2" });
    expect(next.isError).toBeUndefined();
    expect(deaths).toHaveLength(2);
    expect(getLiveBrowserSession(TARGET)).toBeDefined();
  });

  it("does not keep action tools waiting on an owner whose browser died", async () => {
    const { transport, deaths } = fakeTransport();
    const tk = createBrowserToolkit({
      transport,
      profilesDir: "/tmp/ta-test-profiles",
      humanDriverWaitMs: 60_000,
    });
    await run(tk, "browser_snapshot", {});
    await setDriver(TARGET, "human");
    const pending = run(tk, "browser_click", { ref: "e3" });
    await new Promise((r) => setTimeout(r, 300)); // parked behind the takeover

    deaths[0]!();
    const outcome = await Promise.race([
      pending.then(() => "released"),
      new Promise((r) => setTimeout(() => r("still waiting"), 1500)),
    ]);
    expect(outcome).toBe("released");
  });

  it("ignores a death reported by a session that was already closed or replaced", async () => {
    const { transport, log, deaths } = fakeTransport();
    const tk = createBrowserToolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });
    await run(tk, "browser_snapshot", {});
    await closeBrowserSession(TARGET);
    await run(tk, "browser_snapshot", {});
    const fresh = getLiveBrowserSession(TARGET);
    expect(deaths).toHaveLength(2);
    expect(log.filter((e) => e.method === "close")).toHaveLength(1);

    deaths[0]!(); // the first session's late "gone" report
    expect(getLiveBrowserSession(TARGET)).toBe(fresh);
    expect(log.filter((e) => e.method === "close")).toHaveLength(1);
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
    await setDriver(TARGET, "agent"); // already the agent: nothing to adopt
    expect(log.filter((e) => e.method === "adoptActiveTab")).toHaveLength(0);
    await setDriver(TARGET, "human");
    expect(log.filter((e) => e.method === "adoptActiveTab")).toHaveLength(0);
    await setDriver(TARGET, "agent");
    expect(log.filter((e) => e.method === "adoptActiveTab")).toHaveLength(1);
    expect(getLiveBrowserSession(TARGET)?.driver).toBe("agent");
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

    const started = startBrowserSession(TARGET);
    const tool = run(tk, "browser_snapshot", {});
    await new Promise((r) => setTimeout(r, 20));
    expect(browserOpenState(TARGET)).toEqual({ opening: true, phase: "installing" });
    expect(getLiveBrowserSession(TARGET)).toBeUndefined();

    release();
    await started;
    await tool;
    expect(dials).toBe(1);
    expect(log.filter((e) => e.method === "snapshot")).toHaveLength(1);
    expect(browserOpenState(TARGET)).toEqual({ opening: false, error: undefined });
    expect(getLiveBrowserSession(TARGET)).toBeDefined();
  });

  it("remembers why the last open failed until the next attempt", async () => {
    createBrowserToolkit({
      transport: async () => {
        throw new Error("VM exec failed: no sudo");
      },
      profilesDir: "/tmp/ta-test-profiles",
    });
    await expect(startBrowserSession(TARGET)).rejects.toThrow("no sudo");
    const failed = browserOpenState(TARGET);
    expect(failed.opening).toBe(false);
    expect(failed.opening === false && failed.error).toContain("no sudo");

    const { transport } = fakeTransport();
    createBrowserToolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });
    await startBrowserSession(TARGET);
    expect(browserOpenState(TARGET)).toEqual({ opening: false, error: undefined });
  });
});

describe("shared browser profiles", () => {
  beforeEach(() => {
    resetBrowserSessionsForTests();
  });

  /** Conversation n is bot n's, and every bot is on the one shared profile. */
  const resolveTarget = (conversationId: number) => ({
    profile: "shared",
    tab: `bot-${conversationId}`,
  });
  const SHARED = { profile: "shared", tab: "bot-1" };
  const PROFILES = "/tmp/ta-test-profiles";

  /** A browser whose first tab is `t0` and whose later tabs are `t1`, `t2`... */
  function tabbedTransport() {
    const log: string[] = [];
    let launches = 0;
    let opened = 0;
    const tab = (name: string): BrowserSession => ({
      url: () => `https://${name}.example/`,
      adoptActiveTab: async () => void log.push(`${name}:adopt`),
      focus: async () => void log.push(`${name}:focus`),
      navigate: async (url) => {
        log.push(`${name}:navigate`);
        return { url, status: 200 };
      },
      snapshot: async () => {
        log.push(`${name}:snapshot`);
        return "- body [ref=e1]";
      },
      click: async (ref) => {
        log.push(`${name}:click`);
        return { url: ref };
      },
      type: async () => ({ url: "" }),
      press: async () => {},
      scroll: async () => {},
      screenshot: async () => ({ data: "" }),
      close: async () => void log.push(`${name}:close`),
    });
    const transport: BrowserTransport = async () => {
      launches += 1;
      return { ...tab("t0"), openTab: async () => tab(`t${++opened}`) };
    };
    return {
      transport,
      log,
      get launches() {
        return launches;
      },
    };
  }

  it("gives agents on one profile one browser, each in a tab of its own", async () => {
    const fake = tabbedTransport();
    const tk = createBrowserToolkit({
      transport: fake.transport,
      resolveTarget,
      profilesDir: PROFILES,
    });
    // Both agents' first calls race: still one launch, and two tabs.
    await Promise.all([
      run(tk, "browser_navigate", { url: "https://a.example/" }, "1"),
      run(tk, "browser_navigate", { url: "https://b.example/" }, "2"),
    ]);
    expect(fake.launches).toBe(1);
    expect(fake.log.filter((e) => e.endsWith(":navigate")).sort()).toEqual([
      "t0:navigate",
      "t1:navigate",
    ]);
    expect([...getLiveBrowserSession(SHARED)!.tabs.keys()].sort()).toEqual(["bot-1", "bot-2"]);
    // Each agent keeps its tab on later calls.
    await run(tk, "browser_snapshot", {}, "2");
    expect(fake.log).toContain("t1:snapshot");
  });

  it("brings an agent's tab to the front when another agent acted in between", async () => {
    const fake = tabbedTransport();
    const tk = createBrowserToolkit({
      transport: fake.transport,
      resolveTarget,
      profilesDir: PROFILES,
    });
    await run(tk, "browser_snapshot", {}, "1");
    await run(tk, "browser_snapshot", {}, "1");
    expect(fake.log.filter((e) => e.endsWith(":focus"))).toEqual([]); // alone in the browser
    await run(tk, "browser_snapshot", {}, "2");
    await run(tk, "browser_snapshot", {}, "1");
    await run(tk, "browser_snapshot", {}, "1");
    expect(fake.log.filter((e) => e.endsWith(":focus"))).toEqual(["t1:focus", "t0:focus"]);
  });

  it("pauses every agent in the browser while the owner drives, and hands back one tab", async () => {
    const fake = tabbedTransport();
    const tk = createBrowserToolkit({
      transport: fake.transport,
      resolveTarget,
      profilesDir: PROFILES,
      humanDriverWaitMs: 5000,
    });
    await run(tk, "browser_snapshot", {}, "1");
    await run(tk, "browser_snapshot", {}, "2");
    // Taken from bot 1's panel: bot 2 waits too, since it is the same Chrome.
    await setDriver(SHARED, "human");
    const pending = run(tk, "browser_click", { ref: "e1" }, "2");
    await new Promise((r) => setTimeout(r, 300));
    expect(fake.log).not.toContain("t1:click");

    await setDriver({ profile: "shared", tab: "bot-2" }, "agent");
    expect((await pending).isError).toBeUndefined();
    expect(fake.log).toContain("t1:click");
    // Only the bot it was handed back to adopts the tab in front.
    expect(fake.log.filter((e) => e.endsWith(":adopt"))).toEqual(["t1:adopt"]);
  });

  it("lets agents share the one tab where the transport cannot open tabs", async () => {
    const { transport } = fakeTransport();
    const tk = createBrowserToolkit({ transport, resolveTarget, profilesDir: PROFILES });
    await run(tk, "browser_snapshot", {}, "1");
    await run(tk, "browser_snapshot", {}, "2");
    const browser = getLiveBrowserSession(SHARED)!;
    expect(browser.tabs.get("bot-1")).toBe(browser.session);
    expect(browser.tabs.get("bot-2")).toBe(browser.session);
  });

  it("refuses a profile name that is not a plain directory name", async () => {
    const { transport } = fakeTransport();
    const tk = createBrowserToolkit({
      transport,
      resolveTarget: () => ({ profile: "../escape", tab: "x" }),
      profilesDir: PROFILES,
    });
    const r = await run(tk, "browser_snapshot", {});
    expect(r.isError).toBe(true);
    expect(r.text).toContain("Invalid browser profile");
  });
});
