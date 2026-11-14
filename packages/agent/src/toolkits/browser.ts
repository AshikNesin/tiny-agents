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
 * Which browsers are live, and the rules of opening, sharing, takeover and
 * closing them, belong to the session manager (`browser-sessions.ts`); the
 * app creates one and hands it to this toolkit and to its routes. The vault
 * sinks and the credential request sheet live in `browser-vault.ts`.
 */
import { Type } from "@earendil-works/pi-ai";
import type { ToolExecutionResult } from "@earendil-works/pi-durable";
import type { Capability } from "../capabilities";
import { defineToolkit, tool } from "../toolkit";
import type { VaultBroker } from "../vault";
import type { WaitTracker } from "../waiting";
import {
  assertRefShape,
  checkNavigableUrl,
  conversationBrowserTarget,
  createBrowserSessions,
  describeBrowserError,
  type BrowserSessions,
  type BrowserSessionsOptions,
  type BrowserTarget,
} from "@tiny-agents/sandbox/browser";
import { createBrowserVaultTools } from "./browser-vault";

export {
  closeAllBrowserSessions,
  conversationBrowserTarget,
  createBrowserSessions,
  type BrowserDriver,
  type BrowserSession,
  type BrowserSessions,
  type BrowserSessionsOptions,
  type BrowserTarget,
  type BrowserTransport,
  type BrowserVnc,
  isBlockedPrivateUrl,
} from "@tiny-agents/sandbox/browser";

export interface BrowserToolkitOptions extends BrowserSessionsOptions {
  /**
   * The session manager to act through. The app passes the one its routes
   * use; left out, the toolkit creates its own from these options.
   */
  sessions?: BrowserSessions;
  /**
   * Which profile and tab a conversation's tool calls use. Default
   * `conversationBrowserTarget`: a browser of its own per conversation.
   */
  resolveTarget?: (conversationId: number) => BrowserTarget | Promise<BrowserTarget>;
  /** The vault broker: enables `browser_fill_secret` and `browser_enter_code` (issue #56). */
  vault?: VaultBroker;
  /**
   * Counts credential requests waiting on the owner (the runtime's approval
   * tracker). Without it `request_credentials` is not offered.
   */
  ownerWaits?: WaitTracker;
}

const fail = (text: string): ToolExecutionResult => ({
  output: [{ type: "text", text }],
  isError: true,
});

export function createBrowserToolkit(options: BrowserToolkitOptions = {}): Capability {
  const sessions = options.sessions ?? createBrowserSessions(options);
  const targetOf = async (conversationId: number): Promise<BrowserTarget> =>
    (options.resolveTarget ?? conversationBrowserTarget)(conversationId);
  /** Read tools: the agent's tab, in front unless the owner drives. */
  const readTurn = async (conversationId: number) =>
    sessions.readTurn(await targetOf(conversationId));
  /** Action tools: wait out a takeover, then the agent's tab, in front. */
  const actionTurn = async (conversationId: number) =>
    sessions.actionTurn(await targetOf(conversationId));
  const describe = describeBrowserError;

  return defineToolkit({
    id: "browser",
    name: "Browser",
    description: "A real browser the bot drives: navigate, read, click, type, scroll.",
    tools: [
      tool({
        name: "browser_navigate",
        label: "Opened a page",
        askLabel: "open a page",
        summary: "Open a URL in the bot's browser.",
        description:
          "Open a public http(s) URL in the browser. Private and local addresses are refused. " +
          "Returns the final URL (after redirects) and the HTTP status.",
        parameters: Type.Object({
          url: Type.String({ minLength: 8, maxLength: 2000 }),
        }),
        replay: "unsafe",
        execute: async (args, api) => {
          let url: URL;
          try {
            url = checkNavigableUrl(args.url, sessions.exemptHosts);
          } catch (error) {
            return fail((error as Error).message);
          }
          try {
            // Navigation is an action: it must respect takeover like every
            // other effect (navigating away mid-secret breaks the contract).
            const s = await actionTurn(Number(api.conversationId));
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
      tool({
        name: "browser_snapshot",
        label: "Read the page",
        askLabel: "read the page",
        summary: "Snapshot the page's interactive elements with refs.",
        policy: { readOnly: true },
        description:
          "Snapshot the page's interactive elements as a tree with refs (e12, or f1e12 inside a frame). " +
          "Clicking and typing use these refs. Take a new snapshot whenever the page may have changed.",
        parameters: Type.Object({}),
        replay: "safe",
        execute: async (_args, api) => {
          try {
            const s = await readTurn(Number(api.conversationId));
            const text = await s.session.snapshot();
            const capped = text.length > 20_000 ? text.slice(0, 20_000) + "\n…(truncated)" : text;
            return { output: [{ type: "text", text: capped }] };
          } catch (error) {
            return fail(describe(error));
          }
        },
      }),
      tool({
        name: "browser_click",
        label: "Clicked",
        askLabel: "click on the page",
        summary: "Click an element by ref.",
        description:
          "Click an element by its ref from the last snapshot. The element is scrolled into view first.",
        parameters: Type.Object({ ref: Type.String({ minLength: 2, maxLength: 32 }) }),
        replay: "unsafe",
        execute: async (args, api) => {
          try {
            assertRefShape(args.ref);
            const s = await actionTurn(Number(api.conversationId));
            const result = await s.session.click(args.ref);
            return { output: [{ type: "text", text: `clicked ${args.ref} — ${result.url}` }] };
          } catch (error) {
            return fail(describe(error));
          }
        },
      }),
      tool({
        name: "browser_type",
        label: "Typed into",
        askLabel: "type into the page",
        summary: "Type text into an element by ref.",
        description:
          "Replace the text in an editable element by ref. The whole string is inserted at once. " +
          "For a dropdown (combobox), pass the label or value of the option to choose. " +
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
            const s = await actionTurn(Number(api.conversationId));
            const result = await s.session.type(args.ref, args.text);
            return { output: [{ type: "text", text: `typed into ${args.ref} — ${result.url}` }] };
          } catch (error) {
            return fail(describe(error));
          }
        },
      }),
      tool({
        name: "browser_press_key",
        label: "Pressed a key",
        askLabel: "press a key",
        summary: "Press a key (Enter, Tab, Escape, arrows).",
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
            const s = await actionTurn(Number(api.conversationId));
            await s.session.press(args.key);
            return { output: [{ type: "text", text: `pressed ${args.key}` }] };
          } catch (error) {
            return fail(describe(error));
          }
        },
      }),
      tool({
        name: "browser_scroll",
        label: "Scrolled",
        askLabel: "scroll the page",
        summary: "Scroll the page up or down.",
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
            const s = await actionTurn(Number(api.conversationId));
            await s.session.scroll(args.direction, args.amount ?? 600);
            return { output: [{ type: "text", text: `scrolled ${args.direction}` }] };
          } catch (error) {
            return fail(describe(error));
          }
        },
      }),
      tool({
        name: "browser_screenshot",
        label: "Captured the screen",
        askLabel: "capture the screen",
        summary: "JPEG screenshot for visual questions.",
        policy: { readOnly: true },
        description:
          "Capture the viewport as a JPEG. Use for layout or canvas questions a snapshot cannot answer.",
        parameters: Type.Object({
          question: Type.Optional(Type.String({ maxLength: 500, description: "What to look for" })),
        }),
        replay: "safe",
        execute: async (_args, api) => {
          try {
            const s = await readTurn(Number(api.conversationId));
            const shot = await s.session.screenshot();
            return {
              output: [
                { type: "text", text: "Screenshot captured as an attachment." },
                { type: "image", data: shot.data, mimeType: "image/jpeg" },
              ],
              details: { screenshot: true },
            };
          } catch (error) {
            return fail(describe(error));
          }
        },
      }),
      ...createBrowserVaultTools(options, sessions, targetOf),
    ],
  });
}
