import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi, ToolExecutionResult } from "@earendil-works/pi-durable";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  conversationBrowserTarget,
  createBrowserSessions,
  createBrowserToolkit,
  isBlockedPrivateUrl,
  type BrowserDriver,
  type BrowserSession,
  type BrowserSessions,
  type BrowserTarget,
  type BrowserToolkitOptions,
  type BrowserTransport,
} from "../../../../packages/agent/src/toolkits/browser";
import type { Capability } from "../../../../packages/agent/src/capabilities";

let current: BrowserSessions | undefined;
function toolkit(options: BrowserToolkitOptions = {}): Capability {
  current = createBrowserSessions(options);
  return createBrowserToolkit({ ...options, sessions: current });
}
const getLiveBrowserSession = (target: BrowserTarget) => current?.get(target);
const setDriver = (target: BrowserTarget, driver: BrowserDriver) =>
  current!.setDriver(target, driver);
const closeBrowserSession = (target: BrowserTarget) => current!.close(target);
const closeBrowserTab = (target: BrowserTarget) => current!.closeTab(target);
const startBrowserSession = (target: BrowserTarget) => current!.start(target);
const browserOpenState = (target: BrowserTarget) => current!.openState(target);
async function resetBrowserSessionsForTests() {
  const previous = current;
  current = undefined;
  await previous?.closeAll();
}

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
    { conversationId } as unknown as ToolExecutionApi,
    BACKGROUND_CONTEXT,
  )) as ToolExecutionResult;
  const text = (result.output ?? []).map((b) => (b.type === "text" ? b.text : "")).join("");
  return { ...result, text };
}

function fakeTransport() {
  const log: { method: string; args?: unknown }[] = [];
  let url = "about:blank";
  let snapshotText = '- body [ref=e1]\n  - input [ref=e2]\n  - button "Go" [ref=e3]';
  let pageText = "Hello";
  const history: string[] = [];
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
        if (url !== "about:blank") history.push(url);
        url = next;
        return { url: next, status: 200 };
      },
      snapshot: async (scope) => {
        log.push({ method: "snapshot", args: scope });
        return snapshotText;
      },
      text: async (scope) => {
        log.push({ method: "text", args: scope });
        return pageText;
      },
      waitFor: async (wait) => {
        log.push({ method: "waitFor", args: wait });
        return wait.text !== "Never";
      },
      back: async () => {
        log.push({ method: "back" });
        const previous = history.pop();
        if (!previous) return null;
        url = previous;
        return { url, title: "Earlier page" };
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
    setText: (t: string) => (pageText = t),
    get url() {
      return url;
    },
  };
}

describe("browser toolkit", () => {
  beforeEach(async () => {
    await resetBrowserSessionsForTests();
  });

  it("navigates and returns status + final url", async () => {
    const { transport } = fakeTransport();
    const tk = toolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });
    const r = await run(tk, "browser_navigate", { url: "https://example.com/" });
    expect(r.isError).toBeUndefined();
    expect(r.text).toContain("200");
    expect(r.text).toContain("example.com");
  });

  it("refuses private hosts unless exempted", async () => {
    const { transport } = fakeTransport();
    const tk = toolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });
    const denied = await run(tk, "browser_navigate", { url: "http://127.0.0.1:8080/" });
    expect(denied.isError).toBe(true);
    expect(denied.text).toContain("Private");

    const ok = toolkit({
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
    const tk = toolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });
    expect((await run(tk, "browser_navigate", { url: "file:///etc/passwd" })).isError).toBe(true);
    expect((await run(tk, "browser_navigate", { url: "https://u:p@example.com/" })).isError).toBe(
      true,
    );
    expect((await run(tk, "browser_navigate", { url: "javascript:alert(1)" })).isError).toBe(true);
  });

  it("clicks by ref from a snapshot and never echoes typed text", async () => {
    const { transport, log } = fakeTransport();
    const tk = toolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });
    const snap = await run(tk, "browser_snapshot", {});
    expect(snap.text).toContain("[ref=e2]");
    const typed = await run(tk, "browser_type", { ref: "e2", text: "hunter2" });
    expect(typed.isError).toBeUndefined();
    expect(typed.text).not.toContain("hunter2");
    expect(log.some((e) => e.method === "type")).toBe(true);
    const clicked = await run(tk, "browser_click", { ref: "e3" });
    expect(clicked.text).toContain("e3");
  });

  it("reads a long page in windows instead of cutting it at the top", async () => {
    const { transport, setSnapshot } = fakeTransport();
    const tk = toolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });
    const lines = Array.from(
      { length: 1000 },
      (_, i) => `- link "Story ${String(i).padStart(4, "0")}" [ref=e${i}]`,
    );
    setSnapshot(lines.join("\n"));

    const first = await run(tk, "browser_snapshot", {});
    expect(first.text).toContain('"Story 0000"');
    expect(first.text).not.toContain('"Story 0999"');
    const next = /offset (\d+)/.exec(first.text);
    expect(next).not.toBeNull();

    const second = await run(tk, "browser_snapshot", { offset: Number(next![1]) });
    expect(second.text).toContain('"Story 0999"');
    expect(second.text).not.toContain('"Story 0000"');
    expect(second.text).not.toContain("more characters");
  });

  it("keeps only the snapshot lines a query names, refs included", async () => {
    const { transport, setSnapshot } = fakeTransport();
    const tk = toolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });
    setSnapshot(
      '- heading "Cart"\n  - button "Proceed to checkout" [ref=e7]\n  - link "Help" [ref=e8]',
    );

    const found = await run(tk, "browser_snapshot", { query: "Checkout" });
    expect(found.text).toBe('1 matching line:\n- button "Proceed to checkout" [ref=e7]');
    const none = await run(tk, "browser_snapshot", { query: "coupon" });
    expect(none.text).toBe('No line matches "coupon".');
  });

  it("snapshots and reads one region by its ref", async () => {
    const { transport, log, setText } = fakeTransport();
    const tk = toolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });
    setText("The article body.");
    await run(tk, "browser_snapshot", { ref: "e4" });
    const read = await run(tk, "browser_read_text", { ref: "e4" });
    expect(read.text).toBe("The article body.");
    expect(log.filter((e) => e.method === "snapshot" || e.method === "text")).toEqual([
      { method: "snapshot", args: "e4" },
      { method: "text", args: "e4" },
    ]);
    const bad = await run(tk, "browser_read_text", { ref: "main" });
    expect(bad.isError).toBe(true);
  });

  it("goes back a page, and says so when there is none", async () => {
    const { transport } = fakeTransport();
    const tk = toolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });
    const none = await run(tk, "browser_back", {});
    expect(none.isError).toBe(true);
    expect(none.text).toBe("There is no earlier page in this tab.");

    await run(tk, "browser_navigate", { url: "https://example.com/a" });
    await run(tk, "browser_navigate", { url: "https://example.com/b" });
    const back = await run(tk, "browser_back", {});
    expect(back.text.split("\n")[0]).toBe("back to https://example.com/a · Earlier page");
  });

  it("shows a new page's snapshot after navigating, then only what an action changed", async () => {
    const { transport, setSnapshot } = fakeTransport();
    const tk = toolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });
    setSnapshot('- heading "Sign up"\n- textbox "Email" [ref=e2]\n- button "Join" [ref=e3]');

    const opened = await run(tk, "browser_navigate", { url: "https://example.com/join" });
    expect(opened.text).toBe(
      '200 https://example.com/join\nPage:\n- heading "Sign up"\n- textbox "Email" [ref=e2]\n- button "Join" [ref=e3]',
    );

    setSnapshot(
      '- heading "Sign up"\n- textbox "Email" [ref=e2]\n- button "Join" [ref=e3]\n- alert:\n  - text: Email is required',
    );
    const clicked = await run(tk, "browser_click", { ref: "e3" });
    expect(clicked.text).toBe(
      "clicked e3 — https://example.com/join\nChanged on the page (+2 -0 lines):\n+ - alert:\n+   - text: Email is required",
    );

    const again = await run(tk, "browser_click", { ref: "e3" });
    expect(again.text).toBe("clicked e3 — https://example.com/join\nNo change on the page.");
  });

  it("follows a click into the tab it opened, lists the tabs and switches back", async () => {
    const fake = fakeTransport();
    const tabs = [
      { url: "https://example.com/results", title: "Results" },
      { url: "https://example.com/item", title: "Item" },
    ];
    let at = 0;
    const transport: BrowserTransport = async (...args) => ({
      ...(await fake.transport(...args)),
      url: () => tabs[at]!.url,
      click: async () => {
        at = 1;
        return { url: tabs[1]!.url, newTab: true };
      },
      tabs: async () => tabs.map((tab, i) => ({ ...tab, current: i === at })),
      switchTab: async (index) => {
        at = index;
        return tabs[index]!;
      },
    });
    const tk = toolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });
    fake.setSnapshot('- link "Open item" [ref=e5]');
    await run(tk, "browser_snapshot", {});

    fake.setSnapshot('- heading "The item"');
    const clicked = await run(tk, "browser_click", { ref: "e5" });
    expect(clicked.text).toBe(
      'clicked e5 — opened a new tab (2 open, browser_tabs switches): https://example.com/item\nPage:\n- heading "The item"',
    );

    const listed = await run(tk, "browser_tabs", {});
    expect(listed.text).toBe(
      "2 tabs:\n1. https://example.com/results · Results\n2. https://example.com/item · Item (current)",
    );

    fake.setSnapshot('- link "Open item" [ref=e5]');
    const back = await run(tk, "browser_tabs", { select: 1 });
    expect(back.text).toBe(
      'on tab 1: https://example.com/results · Results\nPage:\n- link "Open item" [ref=e5]',
    );
  });

  it("shows the selected tab's page even when it has the same URL as the last tab", async () => {
    const fake = fakeTransport();
    const transport: BrowserTransport = async (...args) => ({
      ...(await fake.transport(...args)),
      url: () => "https://example.com/feed",
      switchTab: async () => ({ url: "https://example.com/feed" }),
    });
    const tk = toolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });
    fake.setSnapshot('- heading "Feed"');
    await run(tk, "browser_snapshot", {});
    const switched = await run(tk, "browser_tabs", { select: 2 });
    expect(switched.text).toBe('on tab 2: https://example.com/feed\nPage:\n- heading "Feed"');
  });

  it("asks for a labeled screenshot and says how many controls it labeled", async () => {
    const fake = fakeTransport();
    const asked: unknown[] = [];
    const transport: BrowserTransport = async (...args) => ({
      ...(await fake.transport(...args)),
      screenshot: async (options) => {
        asked.push(options);
        return { data: "anBn", ...(options?.labels ? { labeled: 3 } : {}) };
      },
    });
    const tk = toolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });
    const labeled = await run(tk, "browser_screenshot", { labels: true });
    expect(labeled.text).toBe(
      "Screenshot captured as an attachment, 3 controls labeled with refs.",
    );
    const plain = await run(tk, "browser_screenshot", {});
    expect(plain.text).toBe("Screenshot captured as an attachment.");
    expect(asked).toEqual([{ labels: true }, undefined]);
  });

  it("keeps typed text out of the page change it returns", async () => {
    const { transport, setSnapshot } = fakeTransport();
    const tk = toolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });
    await run(tk, "browser_snapshot", {});
    setSnapshot('- body [ref=e1]\n  - input [ref=e2]: hunter2\n  - button "Go" [ref=e3]');
    const typed = await run(tk, "browser_type", { ref: "e2", text: "hunter2" });
    expect(typed.text).not.toContain("hunter2");
    expect(typed.text).toContain("+   - input [ref=e2]: [typed text]");
  });

  it("waits for text, and says when it never came", async () => {
    const { transport, log } = fakeTransport();
    const tk = toolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });
    await run(tk, "browser_snapshot", {});
    const seen = await run(tk, "browser_wait_for", { text: "Results" });
    expect(seen.text).toBe('"Results" is on the page\nNo change on the page.');
    const missing = await run(tk, "browser_wait_for", { text: "Never", seconds: 3 });
    expect(missing.text.split("\n")[0]).toBe("still not there after 3 s");
    const gone = await run(tk, "browser_wait_for", { text: "Loading", gone: true });
    expect(gone.text.split("\n")[0]).toBe('"Loading" is gone');
    expect(log.filter((e) => e.method === "waitFor").map((e) => e.args)).toEqual([
      { text: "Results", gone: false, timeoutMs: 10_000 },
      { text: "Never", gone: false, timeoutMs: 3_000 },
      { text: "Loading", gone: true, timeoutMs: 10_000 },
    ]);
  });

  it("invalid refs are rejected", async () => {
    const { transport } = fakeTransport();
    const tk = toolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });
    const bad = await run(tk, "browser_click", { ref: "nope!" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("Invalid ref");
    const framed = await run(tk, "browser_click", { ref: "f1e3" });
    expect(framed.isError).toBeUndefined();
    expect(framed.text).toContain("f1e3");
  });

  it("action tools wait while the human drives, then proceed after release", async () => {
    const { transport, log } = fakeTransport();
    const tk = toolkit({
      transport,
      profilesDir: "/tmp/ta-test-profiles",
      humanDriverWaitMs: 1500,
    });
    await run(tk, "browser_navigate", { url: "https://example.com/" });
    setDriver(TARGET, "human");
    const pending = run(tk, "browser_click", { ref: "e3" });
    await new Promise((r) => setTimeout(r, 300));
    expect(log.filter((e) => e.method === "click")).toHaveLength(0);
    setDriver(TARGET, "agent");
    const done = await pending;
    expect(done.isError).toBeUndefined();
    expect(log.filter((e) => e.method === "click")).toHaveLength(1);
  });

  it("navigate waits while the human drives (takeover covers navigation)", async () => {
    const { transport, log } = fakeTransport();
    const tk = toolkit({
      transport,
      profilesDir: "/tmp/ta-test-profiles",
      humanDriverWaitMs: 1500,
    });
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
    const tk = toolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });
    await run(tk, "browser_navigate", { url: "https://example.com/" });
    expect(getLiveBrowserSession(TARGET)).toBeDefined();
    await closeBrowserSession(TARGET);
    expect(getLiveBrowserSession(TARGET)).toBeUndefined();
    expect(log.some((e) => e.method === "close")).toBe(true);
    const dials = log.filter((e) => e.method === "navigate").length;
    await run(tk, "browser_navigate", { url: "https://example.com/2" });
    expect(log.filter((e) => e.method === "navigate").length).toBeGreaterThan(dials);
  });

  it("drops a browser that died so the next call opens a fresh one", async () => {
    const { transport, log, deaths } = fakeTransport();
    const tk = toolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });
    await run(tk, "browser_navigate", { url: "https://example.com/" });
    expect(getLiveBrowserSession(TARGET)).toBeDefined();
    expect(deaths).toHaveLength(1);

    deaths[0]!();
    expect(getLiveBrowserSession(TARGET)).toBeUndefined();
    expect(log.filter((e) => e.method === "close")).toHaveLength(1);
    const next = await run(tk, "browser_navigate", { url: "https://example.com/2" });
    expect(next.isError).toBeUndefined();
    expect(deaths).toHaveLength(2);
    expect(getLiveBrowserSession(TARGET)).toBeDefined();
  });

  it("does not keep action tools waiting on an owner whose browser died", async () => {
    const { transport, deaths } = fakeTransport();
    const tk = toolkit({
      transport,
      profilesDir: "/tmp/ta-test-profiles",
      humanDriverWaitMs: 60_000,
    });
    await run(tk, "browser_snapshot", {});
    await setDriver(TARGET, "human");
    const pending = run(tk, "browser_click", { ref: "e3" });
    await new Promise((r) => setTimeout(r, 300));

    deaths[0]!();
    let wait: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      pending.then(() => "released"),
      new Promise((r) => (wait = setTimeout(() => r("still waiting"), 1500))),
    ]).finally(() => clearTimeout(wait));
    expect(outcome).toBe("released");
  });

  it("ignores a death reported by a session that was already closed or replaced", async () => {
    const { transport, log, deaths } = fakeTransport();
    const tk = toolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });
    await run(tk, "browser_snapshot", {});
    await closeBrowserSession(TARGET);
    await run(tk, "browser_snapshot", {});
    const fresh = getLiveBrowserSession(TARGET);
    expect(deaths).toHaveLength(2);
    expect(log.filter((e) => e.method === "close")).toHaveLength(1);

    deaths[0]!();
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
    const tk = toolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });
    await run(tk, "browser_snapshot", {});
    await setDriver(TARGET, "agent");
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
    const tk = toolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });

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
    toolkit({
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
    toolkit({ transport, profilesDir: "/tmp/ta-test-profiles" });
    await startBrowserSession(TARGET);
    expect(browserOpenState(TARGET)).toEqual({ opening: false, error: undefined });
  });
});

describe("shared browser profiles", () => {
  beforeEach(async () => {
    await resetBrowserSessionsForTests();
  });

  const resolveTarget = (conversationId: number) => ({
    profile: "shared",
    tab: `bot-${conversationId}`,
  });
  const SHARED = { profile: "shared", tab: "bot-1" };
  const PROFILES = "/tmp/ta-test-profiles";

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
    const tk = toolkit({
      transport: fake.transport,
      resolveTarget,
      profilesDir: PROFILES,
    });
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
    await run(tk, "browser_snapshot", {}, "2");
    expect(fake.log).toContain("t1:snapshot");
  });

  it("closes a deleted agent's own tab and leaves the others (issue #88)", async () => {
    const fake = tabbedTransport();
    const tk = toolkit({
      transport: fake.transport,
      resolveTarget,
      profilesDir: PROFILES,
    });
    await run(tk, "browser_navigate", { url: "https://a.example/" }, "1");
    await run(tk, "browser_navigate", { url: "https://b.example/" }, "2");

    await closeBrowserTab({ profile: "shared", tab: "bot-2" });
    expect(fake.log).toContain("t1:close");
    expect(fake.log).not.toContain("t0:close");
    expect([...getLiveBrowserSession(SHARED)!.tabs.keys()]).toEqual(["bot-1"]);
  });

  it("blanks the browser's first tab instead of closing the browser, then closes it once unused", async () => {
    const fake = tabbedTransport();
    const tk = toolkit({
      transport: fake.transport,
      resolveTarget,
      profilesDir: PROFILES,
    });
    await run(tk, "browser_navigate", { url: "https://a.example/" }, "1");
    await run(tk, "browser_navigate", { url: "https://b.example/" }, "2");
    const navigations = fake.log.filter((entry) => entry === "t0:navigate").length;

    await closeBrowserTab({ profile: "shared", tab: "bot-1" });
    expect(fake.log.filter((entry) => entry === "t0:navigate")).toHaveLength(navigations + 1);
    expect(fake.log).not.toContain("t0:close");
    expect([...getLiveBrowserSession(SHARED)!.tabs.keys()]).toEqual(["bot-2"]);

    await closeBrowserTab({ profile: "shared", tab: "bot-2" });
    expect(fake.log).toContain("t0:close");
    expect(getLiveBrowserSession(SHARED)).toBeUndefined();
  });

  it("brings an agent's tab to the front when another agent acted in between", async () => {
    const fake = tabbedTransport();
    const tk = toolkit({
      transport: fake.transport,
      resolveTarget,
      profilesDir: PROFILES,
    });
    await run(tk, "browser_snapshot", {}, "1");
    await run(tk, "browser_snapshot", {}, "1");
    expect(fake.log.filter((e) => e.endsWith(":focus"))).toEqual([]);
    await run(tk, "browser_snapshot", {}, "2");
    await run(tk, "browser_snapshot", {}, "1");
    await run(tk, "browser_snapshot", {}, "1");
    expect(fake.log.filter((e) => e.endsWith(":focus"))).toEqual(["t1:focus", "t0:focus"]);
  });

  it("pauses every agent in the browser while the owner drives, and hands back one tab", async () => {
    const fake = tabbedTransport();
    const tk = toolkit({
      transport: fake.transport,
      resolveTarget,
      profilesDir: PROFILES,
      humanDriverWaitMs: 5000,
    });
    await run(tk, "browser_snapshot", {}, "1");
    await run(tk, "browser_snapshot", {}, "2");
    await setDriver(SHARED, "human");
    const pending = run(tk, "browser_click", { ref: "e1" }, "2");
    await new Promise((r) => setTimeout(r, 300));
    expect(fake.log).not.toContain("t1:click");

    await setDriver({ profile: "shared", tab: "bot-2" }, "agent");
    expect((await pending).isError).toBeUndefined();
    expect(fake.log).toContain("t1:click");
    expect(fake.log.filter((e) => e.endsWith(":adopt"))).toEqual(["t1:adopt"]);
  });

  it("lets agents share the one tab where the transport cannot open tabs", async () => {
    const { transport } = fakeTransport();
    const tk = toolkit({ transport, resolveTarget, profilesDir: PROFILES });
    await run(tk, "browser_snapshot", {}, "1");
    await run(tk, "browser_snapshot", {}, "2");
    const browser = getLiveBrowserSession(SHARED)!;
    expect(browser.tabs.get("bot-1")).toBe(browser.session);
    expect(browser.tabs.get("bot-2")).toBe(browser.session);
  });

  it("refuses a profile name that is not a plain directory name", async () => {
    const { transport } = fakeTransport();
    const tk = toolkit({
      transport,
      resolveTarget: () => ({ profile: "../escape", tab: "x" }),
      profilesDir: PROFILES,
    });
    const r = await run(tk, "browser_snapshot", {});
    expect(r.isError).toBe(true);
    expect(r.text).toContain("Invalid browser profile");
  });
});
