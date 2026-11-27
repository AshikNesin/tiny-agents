import { Type } from "typebox";
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
  filterSnapshot,
  pageWindow,
  snapshotDiff,
  type BrowserSession,
  type BrowserSessions,
  type BrowserSessionsOptions,
  type BrowserTarget,
} from "@tiny-agents/sandbox/browser";
import { createBrowserVaultTools } from "./browser-vault";
import { fail } from "./result";

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
  sessions?: BrowserSessions;
  resolveTarget?: (conversationId: number) => BrowserTarget | Promise<BrowserTarget>;
  vault?: VaultBroker;
  ownerWaits?: WaitTracker;
  baselineLimit?: number;
}

const READ_LIMIT = 20_000;

const BASELINE_LIMIT = 512;

const landed = (head: string, url: string, title?: string) =>
  `${head}${url}${title ? ` · ${title}` : ""}`;

const NEW_PAGE_LIMIT = 6_000;
const CHANGE_LIMIT = 4_000;

const ref = (description: string) =>
  Type.Optional(Type.String({ minLength: 2, maxLength: 32, description }));
const offset = Type.Optional(
  Type.Integer({ minimum: 0, description: "Character to start from, from the last result's note" }),
);

export function createBrowserToolkit(options: BrowserToolkitOptions = {}): Capability {
  const sessions = options.sessions ?? createBrowserSessions(options);
  const targetOf = async (conversationId: number): Promise<BrowserTarget> =>
    (options.resolveTarget ?? conversationBrowserTarget)(conversationId);
  const readTurn = async (conversationId: number) =>
    sessions.readTurn(await targetOf(conversationId));
  const actionTurn = async (conversationId: number) =>
    sessions.actionTurn(await targetOf(conversationId));
  const describe = describeBrowserError;

  const baselines = new Map<string, { url: string; tree: string }>();
  const baselineLimit = options.baselineLimit ?? BASELINE_LIMIT;
  const baselineKey = async (conversationId: number) => {
    const target = await targetOf(conversationId);
    return `${target.profile}\u0000${target.tab}`;
  };
  const rememberBaseline = (key: string, value: { url: string; tree: string }) => {
    baselines.delete(key);
    baselines.set(key, value);
    while (baselines.size > baselineLimit) {
      const oldest = baselines.keys().next().value;
      if (oldest === undefined) break;
      baselines.delete(oldest);
    }
  };

  async function pageAfter(conversationId: number, session: BrowserSession, hide?: string) {
    let tree: string;
    try {
      tree = await session.snapshot();
    } catch {
      return "";
    }
    const key = await baselineKey(conversationId);
    const url = session.url();
    const before = baselines.get(key);
    rememberBaseline(key, { url, tree });
    const say = (text: string) => (hide ? text.replaceAll(hide, "[typed text]") : text);
    if (!before || before.url !== url) {
      const head = pageWindow(
        tree,
        0,
        NEW_PAGE_LIMIT,
        ", or pass it query or a region's ref",
        "browser_snapshot",
      );
      return say(`\nPage:\n${head.text}`);
    }
    const change = snapshotDiff(before.tree, tree);
    if (change.added === 0 && change.removed === 0) return "\nNo change on the page.";
    const counts = `+${change.added} -${change.removed} lines`;
    if (change.added === 0) {
      return `\nOn the page: ${change.removed} lines went, nothing new (${counts}).`;
    }
    if (change.text.length > CHANGE_LIMIT) {
      return `\nThe page changed a lot (${counts}); take browser_snapshot to read it.`;
    }
    return say(`\nChanged on the page (${counts}):\n${change.text}`);
  }

  return defineToolkit({
    id: "browser",
    name: "Browser",
    description:
      "A real browser the bot drives: navigate, read, click, type, scroll, wait, go back, tabs.",
    deferred: true,
    tools: [
      tool({
        name: "browser_navigate",
        label: "Opened a page",
        askLabel: "open a page",
        summary: "Open a URL in the bot's browser.",
        description:
          "Open a public http(s) URL in the browser. Private and local addresses are refused. " +
          "Returns the final URL (after redirects), the HTTP status and the first part of the page's snapshot. " +
          "To only read a page's content, web_fetch (when you have it) is faster and cheaper; the browser is for " +
          "pages you interact with, sign in to, or that need scripts.",
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
            const s = await actionTurn(Number(api.conversationId));
            const result = await s.session.navigate(url.href);
            const head = `${result.status ?? "no status"} `;
            const page = await pageAfter(Number(api.conversationId), s.session);
            return {
              output: [{ type: "text", text: landed(head, result.url, result.title) + page }],
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
        summary: "Snapshot the page's elements with refs.",
        policy: { readOnly: true },
        description:
          "Snapshot the page as an accessibility tree: headings, text, and every control with a ref " +
          "(e12, or f1e12 inside a frame) and every link with its [url=…]. Clicking and typing use these refs. " +
          "Actions return what they changed, so take a new snapshot only to read the whole page again. On a long page, pass `query` to keep only " +
          "the lines with those words, or `ref` (a region such as main, a form or a dialog) to snapshot " +
          "just that part. To read an article or results as text, browser_read_text is smaller.",
        parameters: Type.Object({
          ref: ref("Snapshot only this element and what is inside it"),
          query: Type.Optional(
            Type.String({
              minLength: 1,
              maxLength: 200,
              description: "Words to find; only the lines containing all of them are returned",
            }),
          ),
          offset,
        }),
        replay: "safe",
        execute: async (args, api) => {
          try {
            if (args.ref) assertRefShape(args.ref);
            const s = await readTurn(Number(api.conversationId));
            const tree = await s.session.snapshot(args.ref);
            if (!args.ref) {
              const key = await baselineKey(Number(api.conversationId));
              rememberBaseline(key, { url: s.session.url(), tree });
            }
            if (args.query) {
              const found = filterSnapshot(tree, args.query);
              if (found.matches === 0) {
                return { output: [{ type: "text", text: `No line matches "${args.query}".` }] };
              }
              const window = pageWindow(found.text, args.offset ?? 0, READ_LIMIT, "");
              const head = `${found.matches} matching line${found.matches === 1 ? "" : "s"}:\n`;
              return { output: [{ type: "text", text: head + window.text }] };
            }
            const window = pageWindow(
              tree,
              args.offset ?? 0,
              READ_LIMIT,
              ", or pass query or a region's ref to read less",
            );
            return { output: [{ type: "text", text: window.text }] };
          } catch (error) {
            return fail(describe(error));
          }
        },
      }),
      tool({
        name: "browser_read_text",
        label: "Read the text",
        askLabel: "read the page's text",
        summary: "Read the page's visible text.",
        policy: { readOnly: true },
        description:
          "Read the visible text of the page, or of one element by its ref (such as main or an article), " +
          "without refs or roles. Use it to read an article, results or a long list; use browser_snapshot " +
          "to find what to click.",
        parameters: Type.Object({ ref: ref("Read only this element"), offset }),
        replay: "safe",
        execute: async (args, api) => {
          try {
            if (args.ref) assertRefShape(args.ref);
            const s = await readTurn(Number(api.conversationId));
            if (!s.session.text)
              return fail("This browser cannot read page text; use browser_snapshot.");
            const text = await s.session.text(args.ref);
            if (!text) return { output: [{ type: "text", text: "The page has no visible text." }] };
            const window = pageWindow(text, args.offset ?? 0, READ_LIMIT, "");
            return { output: [{ type: "text", text: window.text }] };
          } catch (error) {
            return fail(describe(error));
          }
        },
      }),
      tool({
        name: "browser_back",
        label: "Went back",
        askLabel: "go back a page",
        summary: "Go back to the previous page.",
        description: "Go back to the previous page in this tab, like the browser's Back button.",
        parameters: Type.Object({}),
        replay: "unsafe",
        execute: async (_args, api) => {
          try {
            const s = await actionTurn(Number(api.conversationId));
            if (!s.session.back) return fail("This browser cannot go back; use browser_navigate.");
            const result = await s.session.back();
            if (!result) return fail("There is no earlier page in this tab.");
            return {
              output: [
                {
                  type: "text",
                  text:
                    landed("back to ", result.url, result.title) +
                    (await pageAfter(Number(api.conversationId), s.session)),
                },
              ],
              details: { url: result.url },
            };
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
          "Click an element by its ref from the last snapshot. The element is scrolled into view first. " +
          "Returns what changed on the page, or the new page's first part if the click opened one " +
          "(in a new tab too: you go on in that tab).",
        parameters: Type.Object({ ref: Type.String({ minLength: 2, maxLength: 32 }) }),
        replay: "unsafe",
        execute: async (args, api) => {
          try {
            assertRefShape(args.ref);
            const s = await actionTurn(Number(api.conversationId));
            const result = await s.session.click(args.ref);
            if (result.newTab) baselines.delete(await baselineKey(Number(api.conversationId)));
            const page = await pageAfter(Number(api.conversationId), s.session);
            const open = result.newTab ? ((await s.session.tabs?.())?.length ?? 2) : 0;
            const where = result.newTab
              ? `opened a new tab (${open} open, browser_tabs switches): ${result.url}`
              : result.url;
            return { output: [{ type: "text", text: `clicked ${args.ref} — ${where}${page}` }] };
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
            const page = await pageAfter(Number(api.conversationId), s.session, args.text);
            return {
              output: [{ type: "text", text: `typed into ${args.ref} — ${result.url}${page}` }],
            };
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
            const page = await pageAfter(Number(api.conversationId), s.session);
            return { output: [{ type: "text", text: `pressed ${args.key}${page}` }] };
          } catch (error) {
            return fail(describe(error));
          }
        },
      }),
      tool({
        name: "browser_wait_for",
        label: "Waited",
        askLabel: "wait for the page",
        summary: "Wait for text to appear or go away.",
        policy: { readOnly: true },
        description:
          "Wait until text shows on the page (search results, a confirmation), or with gone: true until it " +
          'goes away (a spinner, "Loading…"). Without text, pause for the given seconds. Returns what ' +
          "changed on the page meanwhile. Use it instead of snapshotting again and again while a page loads.",
        parameters: Type.Object({
          text: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
          gone: Type.Optional(
            Type.Boolean({ description: "Wait for the text to go away instead" }),
          ),
          seconds: Type.Optional(
            Type.Integer({
              minimum: 1,
              maximum: 30,
              description: "Longest wait; default 10, or 2 without text",
            }),
          ),
        }),
        replay: "safe",
        execute: async (args, api) => {
          try {
            const s = await readTurn(Number(api.conversationId));
            if (!s.session.waitFor)
              return fail("This browser cannot wait; take browser_snapshot instead.");
            const seconds = args.seconds ?? (args.text ? 10 : 2);
            const met = await s.session.waitFor({
              ...(args.text ? { text: args.text } : {}),
              gone: args.gone ?? false,
              timeoutMs: seconds * 1000,
            });
            const said = !args.text
              ? `waited ${seconds} s`
              : met
                ? args.gone
                  ? `"${args.text}" is gone`
                  : `"${args.text}" is on the page`
                : `still ${args.gone ? "there" : "not there"} after ${seconds} s`;
            const page = await pageAfter(Number(api.conversationId), s.session);
            return { output: [{ type: "text", text: said + page }] };
          } catch (error) {
            return fail(describe(error));
          }
        },
      }),
      tool({
        name: "browser_tabs",
        label: "Switched tabs",
        askLabel: "switch browser tabs",
        summary: "List, switch or close the bot's tabs.",
        description:
          "List your tabs (the one you started in and the ones your clicks opened). " +
          "Pass select to go on in tab N, or close to close tab N.",
        parameters: Type.Object({
          select: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
          close: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
        }),
        replay: "unsafe",
        execute: async (args, api) => {
          try {
            const s = await actionTurn(Number(api.conversationId));
            const { tabs, switchTab, closeTabAt } = s.session;
            const single = fail("This browser has only one tab.");
            if (args.close) {
              if (!closeTabAt) return single;
              await closeTabAt(args.close - 1);
            }
            if (args.select) {
              if (!switchTab) return single;
              const result = await switchTab(args.select - 1);
              baselines.delete(await baselineKey(Number(api.conversationId)));
              const page = await pageAfter(Number(api.conversationId), s.session);
              const text = landed(`on tab ${args.select}: `, result.url, result.title) + page;
              return { output: [{ type: "text", text }] };
            }
            if (!tabs) return single;
            const list = (await tabs()).map(
              (tab, i) =>
                `${landed(`${i + 1}. `, tab.url, tab.title)}${tab.current ? " (current)" : ""}`,
            );
            const head = `${list.length} tab${list.length === 1 ? "" : "s"}:`;
            return { output: [{ type: "text", text: [head, ...list].join("\n") }] };
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
          "Capture the viewport as a JPEG. Use for layout or canvas questions a snapshot cannot answer. " +
          "With labels: true, each control in view shows its ref, so you can click what you see.",
        parameters: Type.Object({
          question: Type.Optional(Type.String({ maxLength: 500, description: "What to look for" })),
          labels: Type.Optional(Type.Boolean({ description: "Draw each control's ref on it" })),
        }),
        replay: "safe",
        execute: async (args, api) => {
          try {
            const s = await readTurn(Number(api.conversationId));
            const shot = await s.session.screenshot(args.labels ? { labels: true } : undefined);
            const text =
              shot.labeled === undefined
                ? "Screenshot captured as an attachment."
                : `Screenshot captured as an attachment, ${shot.labeled} control${shot.labeled === 1 ? "" : "s"} labeled with refs.`;
            return {
              output: [
                { type: "text", text },
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
