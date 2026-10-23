/**
 * The `browser` toolkit (issue #24): a real Chromium the bot drives, the
 * owner watches live, and the owner can take over mid-run.
 *
 * Three ideas carry the design (research: `tmp/browser-use-patterns.md`):
 * - Perception is AX-tree-first with stable refs (playwright-mcp's model);
 *   vision is the `browser_screenshot` fallback.
 * - The owner watches and drives the same Chrome over VNC (see `BrowserVnc`);
 *   takeover is a driver flag that suspends tool dispatch, not a focus lock.
 * - Secrets never enter model context: the owner types them into the real
 *   page during takeover; no tool result ever echoes typed input values.
 *
 * Sessions are per profile, lazy, idle-closed, and the transport is a narrow
 * port (`BrowserTransport`) so tests substitute fakes. Several agents can
 * share one profile (the app's default): they share that one browser, and
 * so its logins, each in a tab of its own (`BrowserTarget`).
 */
import type { Duplex } from "node:stream";
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, type ToolExecutionResult } from "@earendil-works/pi-durable";
import type { Capability } from "../capabilities";
import { checkPublicUrl } from "./web";

/** Where a session is while it opens; `installing` is the one-time VM setup. */
export type BrowserPhase = "installing" | "starting";

export interface OpenBrowserOptions {
  viewportWidth: number;
  viewportHeight: number;
  /** Hosts exempt from the private-address block (redirect checks honor it). */
  allowedPrivateHosts?: string;
  /** Device pixel ratio for transports that stream a real desktop (1 or 2). */
  scale?: number;
  /** Progress callback for slow opens (first-run VM install). */
  onPhase?: (phase: BrowserPhase) => void;
}

/**
 * A real desktop the owner can watch and drive over VNC. Present only on
 * transports that run a headful browser on a display (the VM transport).
 */
export interface BrowserVnc {
  /** Device pixel ratio of the remote desktop; the viewer scales its size by it. */
  scale: number;
  /** A fresh byte stream to the display's RFB server (one per viewer). */
  openStream(): Promise<Duplex>;
  /** Fit the browser window to a viewer, in CSS pixels. */
  resize(width: number, height: number): Promise<void>;
}

/**
 * Where a browser call runs: the profile names the browser (one Chrome per
 * profile directory, since Chrome locks it), the tab names the agent's own
 * tab inside it. Agents with different tabs on one profile share its logins
 * without trampling each other's pages.
 */
export interface BrowserTarget {
  profile: string;
  tab: string;
}

/** The mapping without an app resolver: a browser of its own per conversation. */
export function conversationBrowserTarget(conversationId: number): BrowserTarget {
  return { profile: String(conversationId), tab: String(conversationId) };
}

/** What the toolkit and the live-view routes need from a live browser. */
export interface BrowserSession {
  /** Present when the browser runs on a VNC-served display. */
  vnc?: BrowserVnc;
  /** Follow the tab the owner left in front (after a takeover). */
  adoptActiveTab?(): Promise<void>;
  /**
   * Open another agent's tab in this browser (a shared profile). Its
   * `close()` closes only that tab. Transports that cannot leave it out, and
   * the agents then share the one tab.
   */
  openTab?(): Promise<BrowserSession>;
  /** Bring this tab to the front, where the live view (and the owner) sees it. */
  focus?(): Promise<void>;
  /** Delete the persisted profile; called after `close()` on reset. */
  wipeProfile?(): Promise<void>;
  /**
   * Call `listener` once if the browser dies under the app (a dropped link to
   * a remote Chrome, Chrome exiting), never after `close()`. Transports that
   * cannot tell leave it out.
   */
  onDisconnect?(listener: () => void): void;
  url(): string;
  navigate(url: string): Promise<{ url: string; status: number | null }>;
  snapshot(): Promise<string>;
  click(ref: string): Promise<{ url: string }>;
  type(ref: string, text: string): Promise<{ url: string }>;
  press(key: string): Promise<void>;
  scroll(direction: "up" | "down", amount: number): Promise<void>;
  screenshot(): Promise<{ data: string }>;
  close(): Promise<void>;
}

export type BrowserTransport = (
  profileDir: string,
  open: OpenBrowserOptions,
) => Promise<BrowserSession>;

export type BrowserDriver = "agent" | "human";

export interface BrowserToolkitOptions {
  /** Profiles root; one directory per profile key. Default `./data/browser-profiles`. */
  profilesDir?: string;
  /**
   * Which profile and tab a conversation's tool calls use. Default
   * `conversationBrowserTarget`: a browser of its own per conversation.
   */
  resolveTarget?: (conversationId: number) => BrowserTarget | Promise<BrowserTarget>;
  /** Idle close in minutes (default 10). */
  idleMinutes?: number;
  /** Comma-separated hosts exempt from the private-address block. */
  allowedPrivateHosts?: string;
  /** Override for tests. Default: Playwright Chromium. */
  transport?: BrowserTransport;
  viewportWidth?: number;
  viewportHeight?: number;
  /** Bound for how long action tools wait while the human drives (ms). */
  humanDriverWaitMs?: number;
  /** Device pixel ratio for VNC-streamed sessions (1 or 2, default 2). */
  scale?: number;
}

/** One live browser (a profile): shared by every agent whose target names it. */
export interface LiveBrowserSession {
  /** The browser itself; closing it closes every tab. Also the first agent's tab. */
  session: BrowserSession;
  /** Each agent's tab, by `BrowserTarget.tab`. */
  tabs: Map<string, BrowserSession>;
  /** The owner drives the whole browser, so takeover pauses every agent in it. */
  driver: BrowserDriver;
  lastActivity: number;
  /** This session's idle close window (ms), from the toolkit options. */
  idleMs: number;
  /** The tab last brought to the front, so agents only refocus on a change. */
  front?: string;
}

/** An agent's tab in a live browser: what the tools act on. */
export interface LiveBrowserTab {
  browser: LiveBrowserSession;
  session: BrowserSession;
}

const fail = (text: string): ToolExecutionResult => ({
  output: [{ type: "text", text }],
  isError: true,
});

let profilesRoot: string | undefined;
/** The options the app configured the toolkit with; `startBrowserSession` reuses them. */
let toolkitOptions: BrowserToolkitOptions = {};

export function createBrowserToolkit(options: BrowserToolkitOptions = {}): Capability {
  profilesRoot = options.profilesDir ?? "./data/browser-profiles";
  toolkitOptions = options;
  const tools: { name: string; label: string; description: string; readOnly?: boolean }[] = [
    {
      name: "browser_navigate",
      label: "Opened a page",
      description: "Open a URL in the bot's browser.",
    },
    {
      name: "browser_snapshot",
      label: "Read the page",
      description: "Snapshot the page's interactive elements with refs.",
      readOnly: true,
    },
    { name: "browser_click", label: "Clicked", description: "Click an element by ref." },
    { name: "browser_type", label: "Typed into", description: "Type text into an element by ref." },
    {
      name: "browser_press_key",
      label: "Pressed a key",
      description: "Press a key (Enter, Tab, Escape, arrows).",
    },
    { name: "browser_scroll", label: "Scrolled", description: "Scroll the page up or down." },
    {
      name: "browser_screenshot",
      label: "Captured the screen",
      description: "JPEG screenshot for visual questions.",
      readOnly: true,
    },
  ];

  return {
    id: "browser",
    kind: "toolkit",
    name: "Browser",
    description: "A real browser the bot drives: navigate, read, click, type, scroll.",
    tools,
    extension: defineExtension({
      name: "browser",
      tools: [
        defineTool({
          name: "browser_navigate",
          description:
            "Open a public http(s) URL in the browser. Private and local addresses are refused. " +
            "Returns the final URL (after redirects) and the HTTP status.",
          parameters: Type.Object({
            url: Type.String({ minLength: 8, maxLength: 2000 }),
          }),
          replay: "unsafe",
          execute: async (args, api) => {
            try {
              var url = checkUrl(args.url, options.allowedPrivateHosts);
            } catch (error) {
              return fail((error as Error).message);
            }
            try {
              // Navigation is an action: it must respect takeover like every
              // other effect (navigating away mid-secret breaks the contract).
              const s = await withDriverTurn(options, Number(api.conversationId));
              const result = await s.session.navigate(url.href);
              return {
                output: [{ type: "text", text: `${result.status ?? "no status"} ${result.url}` }],
                details: { url: result.url, status: result.status ?? null },
              };
            } catch (error) {
              return fail(describe(error));
            }
          },
        }),
        defineTool({
          name: "browser_snapshot",
          description:
            "Snapshot the page's interactive elements as a tree with refs. Clicking and typing use these refs. " +
            "Take a new snapshot whenever the page may have changed.",
          parameters: Type.Object({}),
          replay: "safe",
          execute: async (_args, api) => {
            try {
              const s = await readTurn(options, Number(api.conversationId));
              const text = await s.session.snapshot();
              const capped = text.length > 20_000 ? text.slice(0, 20_000) + "\n…(truncated)" : text;
              return { output: [{ type: "text", text: capped }] };
            } catch (error) {
              return fail(describe(error));
            }
          },
        }),
        defineTool({
          name: "browser_click",
          description: "Click an element by its ref from the last snapshot.",
          parameters: Type.Object({ ref: Type.String({ minLength: 2, maxLength: 12 }) }),
          replay: "unsafe",
          execute: async (args, api) => {
            try {
              assertRefShape(args.ref);
              const s = await withDriverTurn(options, Number(api.conversationId));
              const result = await s.session.click(args.ref);
              return { output: [{ type: "text", text: `clicked ${args.ref} — ${result.url}` }] };
            } catch (error) {
              return fail(describe(error));
            }
          },
        }),
        defineTool({
          name: "browser_type",
          description:
            "Type text into an element by ref. Never type credentials: ask the owner to take over instead.",
          parameters: Type.Object({
            ref: Type.String({ minLength: 2, maxLength: 12 }),
            text: Type.String({ minLength: 1, maxLength: 5000 }),
          }),
          replay: "unsafe",
          execute: async (args, api) => {
            try {
              assertRefShape(args.ref);
              const s = await withDriverTurn(options, Number(api.conversationId));
              const result = await s.session.type(args.ref, args.text);
              return { output: [{ type: "text", text: `typed into ${args.ref} — ${result.url}` }] };
            } catch (error) {
              return fail(describe(error));
            }
          },
        }),
        defineTool({
          name: "browser_press_key",
          description:
            "Press a key: Enter, Tab, Escape, Backspace, arrows, Home, End, PageUp, PageDown.",
          parameters: Type.Object({
            key: Type.Union(
              [
                "Enter",
                "Tab",
                "Escape",
                "Backspace",
                "Delete",
                "ArrowUp",
                "ArrowDown",
                "ArrowLeft",
                "ArrowRight",
                "Home",
                "End",
                "PageUp",
                "PageDown",
              ].map((k) => Type.Literal(k)),
            ),
          }),
          replay: "unsafe",
          execute: async (args, api) => {
            try {
              const s = await withDriverTurn(options, Number(api.conversationId));
              await s.session.press(args.key);
              return { output: [{ type: "text", text: `pressed ${args.key}` }] };
            } catch (error) {
              return fail(describe(error));
            }
          },
        }),
        defineTool({
          name: "browser_scroll",
          description: "Scroll the page up or down.",
          parameters: Type.Object({
            direction: Type.Union([Type.Literal("up"), Type.Literal("down")]),
            amount: Type.Optional(
              Type.Integer({ minimum: 50, maximum: 3000, description: "Pixels; default 600" }),
            ),
          }),
          replay: "unsafe",
          execute: async (args, api) => {
            try {
              const s = await withDriverTurn(options, Number(api.conversationId));
              await s.session.scroll(args.direction, args.amount ?? 600);
              return { output: [{ type: "text", text: `scrolled ${args.direction}` }] };
            } catch (error) {
              return fail(describe(error));
            }
          },
        }),
        defineTool({
          name: "browser_screenshot",
          description:
            "Capture the viewport as a JPEG. Use for layout or canvas questions a snapshot cannot answer.",
          parameters: Type.Object({
            question: Type.Optional(
              Type.String({ maxLength: 500, description: "What to look for" }),
            ),
          }),
          replay: "safe",
          execute: async (_args, api) => {
            try {
              const s = await readTurn(options, Number(api.conversationId));
              const shot = await s.session.screenshot();
              return {
                output: [
                  { type: "text", text: "Screenshot captured as an attachment." },
                  { type: "image", data: shot.data, mimeType: "image/jpeg" } as never,
                ],
                details: { screenshot: true },
              };
            } catch (error) {
              return fail(describe(error));
            }
          },
        }),
      ],
    }),
  };
}

// ---------------------------------------------------------------------------
// Session manager: lazy open, idle close, driver arbitration. One instance
// per toolkit; the app creates one toolkit per server process. Browsers are
// keyed by profile, and each agent gets its own tab in its profile's browser.
// ---------------------------------------------------------------------------

const live = new Map<string, LiveBrowserSession>();
/** In-flight opens, so a tool call and the owner's "Open browser" share one launch. */
const opening = new Map<
  string,
  { promise: Promise<LiveBrowserSession>; readonly phase: BrowserPhase }
>();
/** In-flight tab opens per browser, by tab key, so one agent never gets two tabs. */
const tabsOpening = new WeakMap<LiveBrowserSession, Map<string, Promise<BrowserSession>>>();
/** Last open failure per profile, surfaced by the status route until the next attempt. */
const openErrors = new Map<string, string>();
let sweeper: ReturnType<typeof setInterval> | undefined;

/** The live browser for `target.profile`, opening it if needed, and the agent's tab in it. */
export async function acquire(
  options: BrowserToolkitOptions,
  target: BrowserTarget,
): Promise<LiveBrowserTab> {
  const entry = await acquireBrowser(options, target.profile);
  const tab = await tabIn(entry, target.tab);
  entry.lastActivity = Date.now();
  return { browser: entry, session: tab };
}

async function acquireBrowser(
  options: BrowserToolkitOptions,
  profile: string,
): Promise<LiveBrowserSession> {
  touchActivity();
  const entry = live.get(profile);
  if (entry) return entry;
  let pending = opening.get(profile);
  if (!pending) {
    let phase: BrowserPhase = "starting";
    const promise = openSession(options, profile, (next) => {
      phase = next;
    })
      .then((opened) => {
        live.set(profile, opened);
        openErrors.delete(profile);
        return opened;
      })
      .catch((error: unknown) => {
        openErrors.set(profile, describe(error));
        throw error;
      })
      .finally(() => opening.delete(profile));
    pending = {
      promise,
      get phase() {
        return phase;
      },
    };
    opening.set(profile, pending);
  }
  return pending.promise;
}

/**
 * The agent's tab: the browser's first tab goes to the first agent, later
 * agents get a new tab each (or share the first where the transport cannot
 * open tabs).
 */
async function tabIn(entry: LiveBrowserSession, key: string): Promise<BrowserSession> {
  const existing = entry.tabs.get(key);
  if (existing) return existing;
  if (entry.tabs.size === 0 || !entry.session.openTab) {
    entry.tabs.set(key, entry.session);
    return entry.session;
  }
  let pending = tabsOpening.get(entry)?.get(key);
  if (!pending) {
    const inFlight = tabsOpening.get(entry) ?? new Map<string, Promise<BrowserSession>>();
    tabsOpening.set(entry, inFlight);
    pending = entry.session
      .openTab()
      .then((tab) => {
        // A browser closed meanwhile took the tab with it; don't record it.
        if ([...live.values()].includes(entry)) entry.tabs.set(key, tab);
        return tab;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
}

async function openSession(
  options: BrowserToolkitOptions,
  key: string,
  onPhase: (phase: BrowserPhase) => void,
): Promise<LiveBrowserSession> {
  if (!/^[\w-]+$/.test(key)) throw new Error(`Invalid browser profile "${key}".`);
  const root = options.profilesDir ?? "./data/browser-profiles";
  const dir = `${root.replace(/\/$/, "")}/${key}`;
  const { mkdirSync } = await import("node:fs");
  mkdirSync(dir, { recursive: true });
  const transport =
    options.transport ?? (await import("./browser-chromium")).createChromiumTransport();
  const session = await transport(dir, {
    viewportWidth: options.viewportWidth ?? 1280,
    viewportHeight: options.viewportHeight ?? 800,
    allowedPrivateHosts: options.allowedPrivateHosts,
    scale: options.scale === 1 ? 1 : 2,
    onPhase,
  });
  const entry: LiveBrowserSession = {
    session,
    tabs: new Map(),
    driver: "agent",
    lastActivity: Date.now(),
    idleMs: (options.idleMinutes ?? 10) * 60_000,
  };
  session.onDisconnect?.(() => dropDeadSession(key, entry));
  return entry;
}

/**
 * A browser that died under the app must stop answering as live: until the
 * idle sweeper noticed (minutes), every tool call and viewer resize would
 * fail or silently do nothing against it. The next call opens a fresh one.
 */
function dropDeadSession(key: string, entry: LiveBrowserSession): void {
  if (live.get(key) !== entry) return; // already closed, reset or replaced
  live.delete(key);
  entry.driver = "agent"; // release any blocked action tools
  void entry.session.close().catch(() => {});
}

/**
 * Open the browser and the agent's tab without a tool call, for the owner's
 * "Open browser" button. Resolves once the browser is up; the first run on a
 * fresh VM installs the stack and can take minutes, so routes should not
 * await it. The tab comes to the front, so the viewer shows this agent's page.
 */
export async function startBrowserSession(target: BrowserTarget): Promise<LiveBrowserTab> {
  openErrors.delete(target.profile);
  const tab = await acquire(toolkitOptions, target);
  await bringToFront(tab, target.tab);
  return tab;
}

/** What the status route reports for a browser that is not live (yet). */
export function browserOpenState(
  target: BrowserTarget,
): { opening: true; phase: BrowserPhase } | { opening: false; error?: string } {
  const pending = opening.get(target.profile);
  if (pending) return { opening: true, phase: pending.phase };
  return { opening: false, error: openErrors.get(target.profile) };
}

/**
 * True when a URL is private/loopback and not exempt. The toolkit validates
 * the submitted URL; the transport re-checks every redirect hop, so an open
 * redirect on a public site cannot reach the private network.
 */
export function isBlockedPrivateUrl(raw: string, allowedPrivateHosts?: string): boolean {
  const exempt = (allowedPrivateHosts ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  try {
    const url = new URL(raw);
    if (exempt.includes(url.hostname.toLowerCase())) return false;
    checkPublicUrl(raw);
    return false;
  } catch {
    return true; // invalid or private
  }
}

/** Ref shape every transport must honor: `e` + digits from the last snapshot. */
export function assertRefShape(ref: string): void {
  if (!/^e\d+$/.test(ref)) {
    throw new Error(`Invalid ref "${ref}". Use a ref from the last snapshot.`);
  }
}

/** Test seam: drop every live session (each test gets a fresh map). */
export function resetBrowserSessionsForTests(): void {
  for (const [, entry] of live) void entry.session.close();
  live.clear();
  opening.clear();
  openErrors.clear();
}

async function targetOf(options: BrowserToolkitOptions, conversationId: number) {
  return (options.resolveTarget ?? conversationBrowserTarget)(conversationId);
}

/** Read tools: the agent's tab, brought to the front unless the owner drives. */
async function readTurn(
  options: BrowserToolkitOptions,
  conversationId: number,
): Promise<LiveBrowserTab> {
  const target = await targetOf(options, conversationId);
  const tab = await acquire(options, target);
  await bringToFront(tab, target.tab);
  return tab;
}

/** Action tools wait here while the human drives, then re-check. */
async function withDriverTurn(
  options: BrowserToolkitOptions,
  conversationId: number,
): Promise<LiveBrowserTab> {
  const target = await targetOf(options, conversationId);
  const tab = await acquire(options, target);
  const entry = tab.browser;
  const bound = options.humanDriverWaitMs ?? 10 * 60_000;
  const waited = Date.now();
  while (entry.driver === "human" && Date.now() - waited < bound) {
    await new Promise((r) => setTimeout(r, 250));
  }
  if (entry.driver === "human") {
    throw new Error(
      "The owner is driving the browser; wait and retry, or continue without the browser.",
    );
  }
  await bringToFront(tab, target.tab);
  return tab;
}

/**
 * Show the agent's tab when several agents share the browser: the live view
 * follows whoever acts, and Chrome throttles a tab that is in the background.
 * Never while the owner drives (their tab stays in front).
 */
async function bringToFront({ browser, session }: LiveBrowserTab, key: string): Promise<void> {
  if (browser.driver === "human" || browser.front === key) return;
  browser.front = key;
  if (browser.tabs.size > 1) await session.focus?.().catch(() => {});
}

/**
 * Called by the app's routes: flip the driver of the target's browser (every
 * agent in it waits while the owner drives), wake waiters by polling.
 */
export async function setDriver(target: BrowserTarget, driver: BrowserDriver): Promise<void> {
  const entry = live.get(target.profile);
  if (!entry) return;
  const released = entry.driver === "human" && driver === "agent";
  entry.driver = driver;
  if (!released) return;
  // The owner may have opened or switched tabs while driving; the agent
  // they hand back to continues from whichever tab they left in front.
  entry.front = undefined;
  const tab = entry.tabs.get(target.tab);
  if (!tab) return;
  await tab.adoptActiveTab?.().catch(() => {});
  entry.front = target.tab;
}

/**
 * Close and remove the target's browser (every tab in it): later calls open
 * fresh. With `wipeProfile` the persisted profile (cookies, logins) goes too.
 */
export async function closeBrowserSession(
  target: BrowserTarget,
  options: { wipeProfile?: boolean } = {},
): Promise<void> {
  const entry = live.get(target.profile);
  if (entry) {
    entry.driver = "agent"; // release any blocked action tools
    live.delete(target.profile);
    await entry.session.close();
    if (options.wipeProfile) await entry.session.wipeProfile?.();
  }
}

/** Graceful shutdown: close every session so remote browsers do not outlive the app. */
export async function closeAllBrowserSessions(): Promise<void> {
  const sessions = [...live.values()];
  live.clear();
  await Promise.allSettled(sessions.map((entry) => entry.session.close()));
}

/** Profiles root the toolkit was configured with (reset endpoint wipes under it). */
export function browserProfilesDir(): string {
  return profilesRoot ?? "./data/browser-profiles";
}

/** The live browser for the target's profile, whether or not the agent has a tab in it yet. */
export function getLiveBrowserSession(target: BrowserTarget): LiveBrowserSession | undefined {
  return live.get(target.profile);
}

/** Profiles with a live browser. */
export function liveBrowserProfiles(): string[] {
  return [...live.keys()];
}

function touchActivity() {
  if (sweeper) return;
  sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of live) {
      if (entry.driver === "human") continue; // an open takeover is activity
      if (entry.lastActivity < now - entry.idleMs) {
        live.delete(key);
        void entry.session.close();
      }
    }
  }, 60_000);
  sweeper.unref?.();
}

// ---------------------------------------------------------------------------
// URL guard: the same rules as web_fetch, plus optional private exemptions.
// ---------------------------------------------------------------------------

function checkUrl(raw: string, allowedPrivateHosts?: string): URL {
  // Validate shape first (protocol, credentials), then decide on the host.
  let candidate: URL;
  try {
    candidate = new URL(raw);
  } catch {
    throw new Error(`Not a valid URL: ${raw}`);
  }
  if (candidate.protocol !== "http:" && candidate.protocol !== "https:") {
    throw new Error("Only http(s) URLs can be opened.");
  }
  if (candidate.username || candidate.password) {
    throw new Error("URLs with credentials are not allowed.");
  }
  const exempt = (allowedPrivateHosts ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (exempt.includes(candidate.hostname.toLowerCase())) return candidate;
  return checkPublicUrl(raw); // throws for every other private host
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/Executable doesn't exist|playwright install|browserType\.launch/.test(message)) {
    return (
      "No browser is installed on the server. Install one and redeploy: " +
      'either add "chromium" to railpack.json aptPackages (self-hosted deploys), ' +
      "or run `pnpm exec playwright install chromium --with-deps` in the build, " +
      "or set BROWSER_EXECUTABLE_PATH to an existing system binary."
    );
  }
  return message;
}
