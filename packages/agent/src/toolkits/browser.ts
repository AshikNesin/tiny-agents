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
import type { Context } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import {
  defineExtension,
  defineTool,
  type JsonObject,
  type ToolExecutionApi,
  type ToolExecutionResult,
} from "@earendil-works/pi-durable";
import { gateApproved, isUnattendedConversation, withGatePlan } from "../approvals";
import type { Capability } from "../capabilities";
import {
  CREDENTIAL_REQUEST_TTL_MS,
  credentialSubject,
  CREDENTIAL_REQUESTS_PER_HOUR,
  CredentialRequestDoc,
  storedRequest,
  type CredentialField,
  type CredentialFieldType,
  type CredentialRequest,
} from "../credentials";
import { hasGrant, SecretValue, VAULT_RULE, vaultGrant, type VaultBroker } from "../vault";
import { waitForOwner, type WaitTracker } from "../waiting";
import { OriginMismatchError, type SecretFill, type SecretFillField } from "./browser-fill";
import { safeMessage, vaultGatePlan } from "./vault";
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
  /** The top-level page's origin as the live document reports it ("null" for about:blank). */
  origin?(): Promise<string>;
  /**
   * Fill vault values (issue #56), asserting the origin inside the page
   * before each write; returns the keys filled, never a value. Throws
   * `OriginMismatchError` when the page is elsewhere.
   */
  fillSecret?(fill: SecretFill): Promise<{ filled: string[] }>;
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
  /** The vault broker: enables `browser_fill_secret` and `browser_enter_code` (issue #56). */
  vault?: VaultBroker;
  /**
   * Counts credential requests waiting on the owner (the runtime's approval
   * tracker). Without it `request_credentials` is not offered.
   */
  ownerWaits?: WaitTracker;
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
    ...vaultToolInfos(options),
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
            "Snapshot the page's interactive elements as a tree with refs (e12, or f1e12 inside a frame). " +
            "Clicking and typing use these refs. Take a new snapshot whenever the page may have changed.",
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
          description:
            "Click an element by its ref from the last snapshot. The element is scrolled into view first.",
          parameters: Type.Object({ ref: Type.String({ minLength: 2, maxLength: 32 }) }),
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
            "Replace the text in an editable element by ref. The whole string is inserted at once. " +
            "Never type credentials: use browser_fill_secret with a vault handle (see vault_list), " +
            "or request_credentials if no item exists.",
          parameters: Type.Object({
            ref: Type.String({ minLength: 2, maxLength: 32 }),
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
        ...vaultTools(options),
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

/** Ref from the last snapshot: `e12`, or `f1e12` for an element inside a frame. */
export function assertRefShape(ref: string): void {
  if (!/^(?:f\d+)?e\d+$/.test(ref)) {
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

/**
 * Release one agent's tab when its bot goes away, leaving the other agents in
 * the browser alone. A tab of its own closes. The browser's first tab cannot
 * close without closing the browser, so it is blanked and left unassigned;
 * a browser no agent uses any more closes outright.
 */
export async function closeBrowserTab(target: BrowserTarget): Promise<void> {
  const entry = live.get(target.profile);
  const tab = entry?.tabs.get(target.tab);
  if (!entry || !tab) return;
  entry.tabs.delete(target.tab);
  if (entry.front === target.tab) entry.front = undefined;
  if (entry.tabs.size === 0) {
    await closeBrowserSession(target);
    return;
  }
  // A transport without openTab shares one tab between agents: keep it.
  if ([...entry.tabs.values()].includes(tab)) return;
  if (tab === entry.session) {
    await tab.navigate("about:blank").catch(() => undefined);
    return;
  }
  await tab.close().catch(() => undefined);
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

// ---------------------------------------------------------------------------
// Vault sinks (issue #56): fill a vault item into the page, enter a one-time
// code, or have the owner type into a credential request sheet. Values go
// server → page over CDP; results only say which fields were filled.
// ---------------------------------------------------------------------------

function vaultToolInfos(options: BrowserToolkitOptions) {
  return [
    ...(options.vault
      ? [
          {
            name: "browser_fill_secret",
            label: "Filled a saved login",
            description: "Fill a vault login or card into the page without seeing it.",
          },
          {
            name: "browser_enter_code",
            label: "Entered a one-time code",
            description: "Fill a 2FA code from the vault, or ask you for it.",
          },
        ]
      : []),
    ...(options.ownerWaits
      ? [
          {
            name: "request_credentials",
            label: "Asked you to sign in",
            description: "Ask you to type a sign-in, code or card into a secure sheet.",
            // The owner's submit is the consent.
            readOnly: true,
          },
        ]
      : []),
  ];
}

/** The agent's tab without bringing it to the front (planning reads only). */
async function peekTab(options: BrowserToolkitOptions, conversationId: number) {
  return acquire(options, await targetOf(options, conversationId));
}

async function currentOrigin(session: BrowserSession): Promise<string> {
  if (!session.origin || !session.fillSecret) {
    throw new Error("This browser can't fill vault values.");
  }
  return session.origin();
}

type FillableField = "password" | "username" | "card";

function expiryParts(value: SecretValue, wrap: (v: string) => SecretValue) {
  const [month = "", year = ""] = value.reveal().split("/");
  const full = year.length === 2 ? `20${year}` : year;
  return {
    combined: wrap(`${month}/${full.slice(-2)}`),
    month: wrap(month),
    year: wrap(full),
  };
}

const ORIGIN_MOVED = (origin: string) =>
  `The page is now on ${origin}, not the origin this call was approved for. Nothing was filled.`;

/** A credential request's fields as the tool accepts them. */
const credentialFieldSchema = Type.Object({
  key: Type.String({ minLength: 1, maxLength: 32, description: "Slug: password, email, code" }),
  label: Type.String({ minLength: 1, maxLength: 60 }),
  type: Type.Union(
    ["text", "email", "password", "otp", "card_number", "expiry", "cvc", "select"].map((t) =>
      Type.Literal(t),
    ),
  ),
  required: Type.Optional(Type.Boolean()),
  autocomplete: Type.Optional(
    Type.String({ maxLength: 40, description: "HTML autocomplete token (username, email, …)" }),
  ),
  options: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 60 }), { minItems: 1, maxItems: 20 }),
  ),
  ref: Type.Optional(Type.String({ minLength: 2, maxLength: 32 })),
});

/** Identifier-like tokens a visible (text, email, select) field may carry: no free text. */
const IDENTIFIER_TOKENS = new Set([
  "username",
  "email",
  "name",
  "given-name",
  "family-name",
  "tel",
  "organization",
  "postal-code",
  "country",
  "country-name",
  "address-line1",
  "address-line2",
  "address-level1",
  "address-level2",
  "cc-name",
  "cc-exp-month",
  "cc-exp-year",
  "cc-type",
]);

const DEFAULT_TOKEN: Record<CredentialFieldType, string> = {
  text: "username",
  email: "email",
  password: "current-password",
  otp: "one-time-code",
  card_number: "cc-number",
  expiry: "cc-exp",
  cvc: "cc-csc",
  select: "",
};

type CredentialArgs = {
  origin?: string;
  title: string;
  purpose: string;
  fields: {
    key: string;
    label: string;
    type: string;
    required?: boolean;
    autocomplete?: string;
    options?: string[];
    ref?: string;
  }[];
};

/** The request as stored and shown, or why it is refused. */
export function normalizeCredentialRequest(
  args: CredentialArgs,
  pageOrigin: string,
  allowedPrivateHosts?: string,
): CredentialRequest | string {
  let origin: URL;
  try {
    origin = new URL(pageOrigin);
  } catch {
    return "Open the sign-in page in the browser first.";
  }
  const exempt = (allowedPrivateHosts ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (origin.protocol !== "https:" && !exempt.includes(origin.hostname.toLowerCase())) {
    return "Credentials can only be requested for an https page.";
  }
  if (args.origin && args.origin.replace(/\/+$/, "") !== origin.origin) {
    return `The page is on ${origin.origin}, not ${args.origin}. Credentials only fill on the page's own origin.`;
  }
  if (args.fields.length === 0 || args.fields.length > 8) return "Ask for 1 to 8 fields.";
  if (args.title.length > 80 || args.purpose.length > 200) return "Title or purpose is too long.";
  const keys = new Set<string>();
  const fields: CredentialField[] = [];
  for (const field of args.fields) {
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(field.key) || keys.has(field.key)) {
      return `Field key "${field.key}" must be a unique lowercase slug.`;
    }
    keys.add(field.key);
    const type = field.type as CredentialFieldType;
    const autocomplete = (field.autocomplete ?? DEFAULT_TOKEN[type]).trim().toLowerCase();
    if (
      (type === "text" || type === "email" || type === "select") &&
      !IDENTIFIER_TOKENS.has(autocomplete)
    ) {
      return `Field "${field.key}" needs an identifier autocomplete (username, email, name, postal-code, …); free-text fields are not allowed.`;
    }
    if (type === "select" && !field.options?.length) return `Field "${field.key}" needs options.`;
    if (field.ref) {
      try {
        assertRefShape(field.ref);
      } catch (error) {
        return (error as Error).message;
      }
    }
    fields.push({
      key: field.key,
      label: field.label.replace(/\s+/g, " ").trim(),
      type,
      required: field.required ?? true,
      autocomplete,
      ...(type === "select" ? { options: field.options } : {}),
      ...(field.ref ? { ref: field.ref } : {}),
    });
  }
  return {
    origin: origin.origin,
    title: args.title.replace(/\s+/g, " ").trim(),
    purpose: args.purpose.replace(/\s+/g, " ").trim(),
    fields,
  };
}

/** Open credential requests and recent ones, per conversation (rate limits). */
const openRequests = new Map<number, number>();
const recentRequests = new Map<number, number[]>();

function vaultTools(options: BrowserToolkitOptions) {
  const broker = options.vault;
  const tracker = options.ownerWaits;
  const tools = [];

  /** Ask the owner through the credential request sheet and wait (shared by enter_code). */
  const requestCredentials = async (
    args: CredentialArgs,
    api: ToolExecutionApi,
    context: Context,
  ): Promise<ToolExecutionResult> => {
    if (!tracker) return fail("Credential requests are not available.");
    const conversation = Number(api.conversationId);
    const taskId = Number(api.taskId);
    const existing = await api.snapshot(CredentialRequestDoc, api.taskId, context);
    let request = existing ? storedRequest(existing) : null;
    if (!request) {
      // A routine's run (issue #63) has nobody to fill the sheet.
      if (await isUnattendedConversation(api, context)) {
        return fail(
          "Nobody can fill credentials here: this is a scheduled routine run. Use a saved vault item, or say in your reply what is needed.",
        );
      }
      const tab = await peekTab(options, conversation);
      const normalized = normalizeCredentialRequest(
        args,
        await currentOrigin(tab.session).catch(() => "null"),
        options.allowedPrivateHosts,
      );
      if (typeof normalized === "string") return fail(normalized);
      const open = openRequests.get(conversation);
      if (open !== undefined && open !== taskId) {
        return fail("A credential request is already open in this chat. Wait for the owner.");
      }
      const hour = Date.now() - 60 * 60_000;
      const recent = (recentRequests.get(conversation) ?? []).filter((at) => at > hour);
      if (recent.length >= CREDENTIAL_REQUESTS_PER_HOUR) {
        return fail(
          "Too many credential requests this hour. Ask the owner to take over the browser.",
        );
      }
      recentRequests.set(conversation, [...recent, Date.now()]);
      const saved = broker
        ? await broker
            .requested({ conversation, taskId, origin: normalized.origin, title: normalized.title })
            .catch(() => ({ savedHandle: undefined }))
        : { savedHandle: undefined };
      request = { ...normalized, ...(saved.savedHandle ? { savedHandle: saved.savedHandle } : {}) };
    }
    const stored = request;
    openRequests.set(conversation, taskId);
    try {
      const doc = await waitForOwner(
        api,
        tracker,
        CredentialRequestDoc,
        (value) => ({
          credentials: "pending",
          request: stored as unknown as JsonObject,
          expiresAt: value.expiresAt,
        }),
        context,
        (value) => {
          if (!value.request) {
            value.request = stored as unknown as JsonObject;
            value.expiresAt = Date.now() + CREDENTIAL_REQUEST_TTL_MS;
          }
        },
        { tool: "request_credentials", subject: credentialSubject(stored) },
      );
      const result = {
        status: doc.status,
        filled_fields: doc.filled,
        ...(doc.savedHandle ? { saved_item_handle: doc.savedHandle } : {}),
      };
      const next =
        doc.status === "filled"
          ? " Submit the form (take a snapshot to find the button)."
          : doc.status === "cancelled"
            ? " The owner cancelled: don't ask again unless they say so."
            : " Nobody answered in time.";
      return {
        output: [{ type: "text", text: JSON.stringify(result) + next }],
        ...(doc.status === "filled" ? {} : { isError: true }),
        details: {
          credentials: doc.status,
          request: stored as unknown as JsonObject,
          filled: doc.filled,
          ...(doc.savedHandle ? { savedHandle: doc.savedHandle } : {}),
        },
      };
    } finally {
      if (openRequests.get(conversation) === taskId) openRequests.delete(conversation);
    }
  };

  if (broker) {
    tools.push(
      withGatePlan(
        defineTool({
          name: "browser_fill_secret",
          description:
            "Fill a vault item into the current page without seeing its value: a login's password " +
            "(or username), or a card's number, expiry, security code and name. Find the handle with " +
            "vault_list. Only fills on the item's exact origins. Pass `ref` from the last snapshot " +
            "for a single field; otherwise the fields are found by their form markup. Type the " +
            "username yourself with browser_type if you prefer. " +
            VAULT_RULE,
          parameters: Type.Object({
            handle: Type.String({ minLength: 1, maxLength: 64 }),
            field: Type.Optional(
              Type.Union(
                [Type.Literal("password"), Type.Literal("username"), Type.Literal("card")],
                {
                  description: "Default: password for logins, card for cards",
                },
              ),
            ),
            ref: Type.Optional(Type.String({ minLength: 2, maxLength: 32 })),
          }),
          replay: "unsafe",
          execute: async (args, api, context) => {
            try {
              if (args.ref) assertRefShape(args.ref);
              const s = await withDriverTurn(options, Number(api.conversationId));
              const origin = await currentOrigin(s.session);
              const use = {
                handle: args.handle,
                tool: "browser_fill_secret",
                target: origin,
                conversation: Number(api.conversationId),
                granted: await hasGrant(api, vaultGrant(args.handle), context),
              };
              const planned = await api.memo<{ target?: string }>("vault:use", context);
              if (planned?.target && planned.target !== origin) {
                await broker.record(use, "refused_origin", "page moved after planning");
                return fail(ORIGIN_MOVED(origin));
              }
              let chosen = "password" as FillableField;
              const result = await broker.use(
                { ...use, approved: await gateApproved(api, context) },
                (item) => {
                  chosen = args.field ?? (item.kind === "card" ? "card" : "password");
                  if (chosen === "card") {
                    if (item.kind !== "card") return [];
                    return ["card_number", "card_expiry", "card_cvc", "card_holder"];
                  }
                  return item.kind === "login" ? [chosen] : [];
                },
                async (values, item) => {
                  const fields: SecretFillField[] = [];
                  const wrap = (v: string) => new SecretValue(v);
                  if (chosen === "card") {
                    if (values.card_number) {
                      fields.push({
                        key: "card_number",
                        autocomplete: "cc-number",
                        value: wrap(values.card_number.reveal().replace(/\D/g, "")),
                      });
                    }
                    if (values.card_expiry) {
                      const parts = expiryParts(values.card_expiry, wrap);
                      fields.push(
                        { key: "card_expiry", autocomplete: "cc-exp", value: parts.combined },
                        {
                          key: "card_expiry_month",
                          autocomplete: "cc-exp-month",
                          value: parts.month,
                        },
                        { key: "card_expiry_year", autocomplete: "cc-exp-year", value: parts.year },
                      );
                    }
                    if (values.card_cvc) {
                      fields.push({
                        key: "card_cvc",
                        autocomplete: "cc-csc",
                        value: values.card_cvc,
                      });
                    }
                    if (values.card_holder) {
                      fields.push({
                        key: "card_holder",
                        autocomplete: "cc-name",
                        value: values.card_holder,
                      });
                    }
                  } else {
                    const value = values[chosen];
                    if (value) {
                      fields.push({
                        key: chosen,
                        autocomplete: chosen === "password" ? "current-password" : "username",
                        value,
                        ...(args.ref ? { ref: args.ref } : {}),
                      });
                    }
                  }
                  const fill: SecretFill = {
                    origin,
                    // An embedded payment form may sit on one of the item's other origins.
                    frameOrigins: item.origins.filter((o) => o !== origin),
                    fields,
                  };
                  return s.session.fillSecret!(fill);
                },
              );
              const filled = [
                ...new Set(result.filled.map((key) => key.replace(/_(month|year)$/, ""))),
              ];
              if (filled.length === 0) {
                return fail(
                  `No matching field found on ${origin}. Take a snapshot and pass the field's ref.`,
                );
              }
              const next =
                chosen === "card"
                  ? "Check the order total, then submit."
                  : `Submit the form; if asked for a one-time code, call browser_enter_code with handle ${args.handle}.`;
              return {
                output: [{ type: "text", text: JSON.stringify({ filled, origin, next }) }],
                details: { filled, origin },
              };
            } catch (error) {
              if (error instanceof OriginMismatchError) {
                return fail(ORIGIN_MOVED(error.actual));
              }
              return fail(safeMessage(error));
            }
          },
        }),
        vaultGatePlan(broker, true, async (args: { handle: string }, api) => {
          const tab = await peekTab(options, Number(api.conversationId));
          const origin = await currentOrigin(tab.session);
          if (!/^https?:\/\//.test(origin)) {
            return { refuse: "Open the sign-in or checkout page in the browser first." };
          }
          return { handle: args.handle, tool: "browser_fill_secret", target: origin };
        }),
      ),
      withGatePlan(
        defineTool({
          name: "browser_enter_code",
          description:
            "Enter a 2FA one-time code into the current page. With a vault handle whose item has a " +
            "one-time-password seed, the server generates the code and fills it. Without one (codes " +
            "sent by SMS or email), the owner is asked to type it into a secure sheet. " +
            VAULT_RULE,
          parameters: Type.Object({
            handle: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
            ref: Type.Optional(Type.String({ minLength: 2, maxLength: 32 })),
          }),
          replay: "unsafe",
          execute: async (args, api, context) => {
            const askOwner = () =>
              requestCredentials(
                {
                  title: "Enter the one-time code",
                  purpose: "The site asks for a verification code.",
                  fields: [
                    {
                      key: "code",
                      label: "One-time code",
                      type: "otp",
                      autocomplete: "one-time-code",
                      ...(args.ref ? { ref: args.ref } : {}),
                    },
                  ],
                },
                api,
                context,
              );
            try {
              if (args.ref) assertRefShape(args.ref);
              if (!args.handle) return await askOwner();
              const s = await withDriverTurn(options, Number(api.conversationId));
              const origin = await currentOrigin(s.session);
              const use = {
                handle: args.handle,
                tool: "browser_enter_code",
                target: origin,
                conversation: Number(api.conversationId),
                granted: await hasGrant(api, vaultGrant(args.handle), context),
              };
              const planned = await api.memo<{ target?: string }>("vault:use", context);
              if (planned?.target && planned.target !== origin) {
                await broker.record(use, "refused_origin", "page moved after planning");
                return fail(ORIGIN_MOVED(origin));
              }
              let hasSeed = true;
              const result = await broker.use(
                { ...use, approved: await gateApproved(api, context) },
                (item) => {
                  hasSeed = item.hasTotp;
                  return item.hasTotp ? ["totp"] : [];
                },
                async (values) =>
                  values.totp
                    ? s.session.fillSecret!({
                        origin,
                        fields: [
                          {
                            key: "code",
                            autocomplete: "one-time-code",
                            value: values.totp,
                            ...(args.ref ? { ref: args.ref } : {}),
                          },
                        ],
                      })
                    : { filled: [] },
              );
              if (!hasSeed) return await askOwner();
              if (result.filled.length === 0) {
                return fail(
                  `No code field found on ${origin}. Take a snapshot and pass the field's ref.`,
                );
              }
              return {
                output: [
                  {
                    type: "text",
                    text: JSON.stringify({ filled: ["code"], origin, next: "Submit the code." }),
                  },
                ],
                details: { filled: ["code"], origin },
              };
            } catch (error) {
              if (error instanceof OriginMismatchError) return fail(ORIGIN_MOVED(error.actual));
              return fail(safeMessage(error));
            }
          },
        }),
        vaultGatePlan(broker, false, async (args: { handle?: string }, api) => {
          if (!args.handle) return undefined;
          const tab = await peekTab(options, Number(api.conversationId));
          const origin = await currentOrigin(tab.session);
          if (!/^https?:\/\//.test(origin))
            return { refuse: "Open the page asking for the code first." };
          return { handle: args.handle, tool: "browser_enter_code", target: origin };
        }),
      ),
    );
  }

  if (tracker) {
    tools.push(
      defineTool({
        name: "request_credentials",
        description:
          "Ask the owner to type credentials for the current page into a secure sheet: a sign-in, " +
          "a one-time code sent by SMS or email, or a card. The server fills what they type " +
          "straight into the page (only on its current origin) and you only learn which fields " +
          "were filled. Call vault_list first and prefer browser_fill_secret when a handle exists. " +
          "Fields: 1-8, each with a slug key, a short label and a type; text, email and select " +
          "fields need an identifier autocomplete (username, email, name, postal-code, …). " +
          "Your reply pauses until the owner answers (10 minutes at most). " +
          VAULT_RULE,
        parameters: Type.Object({
          origin: Type.Optional(
            Type.String({ maxLength: 300, description: "The page's origin; checked, not trusted" }),
          ),
          title: Type.String({ minLength: 1, maxLength: 80, description: "Sign in to Umami" }),
          purpose: Type.String({ minLength: 1, maxLength: 200 }),
          fields: Type.Array(credentialFieldSchema, { minItems: 1, maxItems: 8 }),
        }),
        // Re-running only re-attaches to the call's document (waitForOwner).
        replay: "safe",
        execute: async (args, api, context) => {
          try {
            return await requestCredentials(args, api, context);
          } catch (error) {
            return fail(describe(error));
          }
        },
      }),
    );
  }
  return tools;
}

/**
 * Fill values into the agent's live tab for `target` (the credential request
 * submit route). Throws when the browser is closed or the page is not on
 * `fill.origin`.
 */
export async function fillSecretInBrowser(
  target: BrowserTarget,
  fill: SecretFill,
): Promise<{ filled: string[] }> {
  const tab = live.get(target.profile)?.tabs.get(target.tab);
  if (!tab?.fillSecret) throw new Error("The bot's browser is not open any more.");
  return tab.fillSecret(fill);
}

/** The agent's live tab's top-level origin, if its browser is open. */
export async function browserTabOrigin(target: BrowserTarget): Promise<string | undefined> {
  const tab = live.get(target.profile)?.tabs.get(target.tab);
  return tab?.origin?.().catch(() => undefined);
}
