/**
 * The `browser` toolkit (issue #24): a real Chromium the bot drives, the
 * owner watches live, and the owner can take over mid-run.
 *
 * Three ideas carry the design (research: `tmp/browser-use-patterns.md`):
 * - Perception is AX-tree-first with stable refs (playwright-mcp's model);
 *   vision is the `browser_screenshot` fallback.
 * - Human and agent are peers at the input channel (CDP `Input.*`); takeover
 *   is a driver flag that suspends tool dispatch, not a focus lock.
 * - Secrets never enter model context: the owner types them into the real
 *   page during takeover; no tool result ever echoes typed input values.
 *
 * Sessions are per-profile (per bot in the app), lazy, idle-closed, and the
 * transport is a narrow port (`BrowserTransport`) so tests substitute fakes.
 */
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, type ToolExecutionResult } from "@earendil-works/pi-durable";
import type { Capability } from "../capabilities";
import { checkPublicUrl } from "./web";

/** One JPEG frame from the viewport, already acked. */
export interface BrowserFrame {
  jpeg: Buffer;
}

/** Human input events injected into the page as real input. */
export type BrowserInput =
  | { kind: "mouse"; x: number; y: number }
  | { kind: "scroll"; x: number; y: number; deltaY: number }
  | { kind: "key"; key: string; text?: string };

export interface BrowserSessionEvents {
  frame?(frame: BrowserFrame): void;
  closed?(): void;
}

export interface OpenBrowserOptions {
  viewportWidth: number;
  viewportHeight: number;
  /** Hosts exempt from the private-address block (redirect checks honor it). */
  allowedPrivateHosts?: string;
}

/** What the toolkit and the live-view routes need from a live browser. */
export interface BrowserSession {
  url(): string;
  on(events: BrowserSessionEvents): () => void;
  navigate(url: string): Promise<{ url: string; status: number | null }>;
  snapshot(): Promise<string>;
  click(ref: string): Promise<{ url: string }>;
  type(ref: string, text: string): Promise<{ url: string }>;
  press(key: string): Promise<void>;
  scroll(direction: "up" | "down", amount: number): Promise<void>;
  screenshot(): Promise<{ data: string }>;
  input(event: BrowserInput): Promise<void>;
  startScreencast(): Promise<void>;
  stopScreencast(): Promise<void>;
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
}

export interface LiveBrowserSession {
  session: BrowserSession;
  driver: BrowserDriver;
  lastActivity: number;
  /** This session's idle close window (ms), from the toolkit options. */
  idleMs: number;
}

const fail = (text: string): ToolExecutionResult => ({
  output: [{ type: "text", text }],
  isError: true,
});

let profilesRoot: string | undefined;

export function createBrowserToolkit(options: BrowserToolkitOptions = {}): Capability {
  profilesRoot = options.profilesDir ?? "./data/browser-profiles";
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
              const s = await acquire(options, Number(api.conversationId));
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
              const s = await acquire(options, Number(api.conversationId));
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
// per toolkit; the app creates one toolkit per server process.
// ---------------------------------------------------------------------------

const live = new Map<string, LiveBrowserSession>();
let sweeper: ReturnType<typeof setInterval> | undefined;

export async function acquire(
  options: BrowserToolkitOptions,
  conversationId: number,
): Promise<LiveBrowserSession> {
  const key = String(conversationId);
  touchActivity();
  let entry = live.get(key);
  if (!entry) {
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
    });
    entry = {
      session,
      driver: "agent",
      lastActivity: Date.now(),
      idleMs: (options.idleMinutes ?? 10) * 60_000,
    };
    live.set(key, entry);
  }
  entry.lastActivity = Date.now();
  return entry;
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
}

/** Action tools wait here while the human drives, then re-check. */
async function withDriverTurn(
  options: BrowserToolkitOptions,
  conversationId: number,
): Promise<LiveBrowserSession> {
  const entry = await acquire(options, conversationId);
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
  return entry;
}

/** Called by the app's routes: flip the driver, wake waiters by polling. */
export function setDriver(conversationId: number, driver: BrowserDriver): void {
  const entry = live.get(String(conversationId));
  if (entry) entry.driver = driver;
}

/** Close and remove a session (profile reset): later calls open fresh. */
export async function closeBrowserSession(conversationId: number): Promise<void> {
  const entry = live.get(String(conversationId));
  if (entry) {
    entry.driver = "agent"; // release any blocked action tools
    live.delete(String(conversationId));
    await entry.session.close();
  }
}

/** Profiles root the toolkit was configured with (reset endpoint wipes under it). */
export function browserProfilesDir(): string {
  return profilesRoot ?? "./data/browser-profiles";
}

export function getLiveBrowserSession(conversationId: number): LiveBrowserSession | undefined {
  return live.get(String(conversationId));
}

export function liveBrowserConversations(): number[] {
  return [...live.keys()].map(Number);
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
