/**
 * What a tool call says (lib/tool-call-text.ts): labels, the approval and
 * vault cards' sentences, the approval note, durations, and how runs of
 * finished calls fold and are described. ChatMessageView draws these as
 * they come; its own tests keep one rendering per card.
 */
import { describe, expect, it } from "vite-plus/test";
import type { ChatToolCall } from "@/lib/chat-types";
import {
  approvalNote,
  approvalPayload,
  approvalText,
  argSummary,
  credentialRequestText,
  describeCalls,
  durationText,
  expiryText,
  formatDuration,
  formatWait,
  groupText,
  NO_TOOL_LABELS,
  stepTitle,
  toolAskLabel,
  toolLabel,
  toolLabelCatalog,
  toolSteps,
  vaultApprovalText,
  type ToolLabelCatalog,
} from "@/lib/tool-call-text";

const call = (name: string, extra: Partial<ChatToolCall> = {}): ChatToolCall => ({
  id: name,
  name,
  args: {},
  status: "done",
  ...extra,
});

const labels: ToolLabelCatalog = toolLabelCatalog([
  {
    tools: [
      { name: "browser_navigate", label: "Opened a page", askLabel: "open a page" },
      { name: "web_search", label: "Searched the web", askLabel: "search the web" },
    ],
  },
  { tools: [{ name: "mcp__notion__search_pages", label: "Search pages" }] },
]);

describe("labels", () => {
  it("builds the catalog from the capabilities' tools; connection tools have no ask label", () => {
    expect(labels).toEqual({
      done: {
        browser_navigate: "Opened a page",
        web_search: "Searched the web",
        mcp__notion__search_pages: "Search pages",
      },
      ask: { browser_navigate: "open a page", web_search: "search the web" },
    });
  });

  it("labels a tool from the catalog, else its prettified name", () => {
    expect(toolLabel(labels, "browser_navigate")).toBe("Opened a page");
    expect(toolLabel(NO_TOOL_LABELS, "mcp__linear__create_issue")).toBe("Create Issue via linear");
    expect(toolLabel(NO_TOOL_LABELS, "delete_task")).toBe("delete task");
  });

  it("asks in the imperative, else 'use <label>'", () => {
    expect(toolAskLabel(labels, "browser_navigate")).toBe("open a page");
    expect(toolAskLabel(labels, "mcp__notion__search_pages")).toBe("use Search pages");
    expect(toolAskLabel(NO_TOOL_LABELS, "mcp__linear__create_issue")).toBe(
      "use Create Issue via linear",
    );
  });
});

describe("argument summary and step titles", () => {
  it("takes the first telling argument, trimmed, at most 60 characters", () => {
    expect(argSummary(call("x", { args: { text: "b", title: "  Fix SSE  " } }))).toBe("Fix SSE");
    expect(argSummary(call("x", { args: { title: " ", query: "q" } }))).toBe("q");
    expect(argSummary(call("x", { args: { url: "u".repeat(80) } }))).toHaveLength(60);
    expect(argSummary(call("x", { args: { foo: "first" } }))).toBe("first");
    expect(argSummary(call("x", { args: { foo: 3 } }))).toBe("");
  });

  it("titles a row by label and summary, and a skill by name", () => {
    expect(stepTitle(call("browser_navigate", { args: { url: "https://a.b" } }), labels)).toBe(
      "Opened a page “https://a.b”",
    );
    expect(stepTitle(call("web_search"), labels)).toBe("Searched the web");
    expect(stepTitle(call("load_skill", { args: { name: "pdf" } }), labels)).toBe(
      "Using skill pdf",
    );
  });
});

describe("approval cards", () => {
  it("says what the bot wants to do, with the summary and the always-allow hint", () => {
    const text = approvalText(
      call("browser_navigate", { args: { url: "https://example.com" } }),
      "Engineer",
      labels,
    );
    expect(text).toEqual({
      title: "Engineer wants to open a page — “https://example.com”",
      alwaysAllowHint: "Approve, and let Engineer open a page without asking",
    });
  });

  it("folds a long self-improve payload behind Read more", () => {
    const long = "delegate coding tasks. ".repeat(10);
    expect(approvalPayload(call("update_instructions", { args: { append: "short" } }))).toBe(
      "short",
    );
    const text = approvalText(
      call("update_instructions", { args: { instructions: long } }),
      "Engineer",
      { done: {}, ask: { update_instructions: "update own instructions" } },
    );
    expect(text.title).toBe(`Engineer wants to update own instructions — “${long.slice(0, 60)}”`);
    expect(text.foldedPayload).toBe(long);
  });

  it("names the vault item and where it goes, never the value", () => {
    const vault = {
      handle: "vault:github",
      label: "GitHub login",
      kind: "login" as const,
      tool: "browser_fill_secret",
      target: "github.com",
      grantable: true,
      username: "me",
    };
    expect(
      vaultApprovalText(call("browser_fill_secret", { vault, expiresAt: 90_000 }), "Bot", 0),
    ).toEqual({
      title: "Bot wants to fill GitHub login on github.com",
      description:
        "As me. The value goes straight into the page; Bot never sees it. Expires in 2 minutes.",
      grantHint: "Approve and stop asking about vault:github in this chat",
    });
    const card = { ...vault, tool: "http_request", username: undefined };
    expect(
      vaultApprovalText(
        call("http_request", { vault: { ...card, card: { brand: "Visa", last4: "4242" } } }),
        "Bot",
      ),
    ).toMatchObject({
      title: "Bot wants to send Visa ••4242 to github.com",
      description: "The value goes straight into the request; Bot never sees it.",
    });
  });

  it("shows a command's secrets and reach", () => {
    const vault = {
      handle: "h",
      label: "Key",
      kind: "api_key" as const,
      tool: "run_command",
      target: "curl api",
      grantable: false,
      env: ["TOKEN"],
    };
    expect(vaultApprovalText(call("run_command", { vault }), "Bot")).toMatchObject({
      title: "Bot wants to run a command with Key",
      command: "curl api",
      description:
        "TOKEN is set for this command only, and it can reach only nothing. Bot never sees the value, but the command can use it: check what it does.",
    });
  });

  it("asks for credentials on the origin's host", () => {
    const credentials = {
      status: "pending" as const,
      origin: "https://x.com/login",
      title: "Sign in",
      purpose: "p",
      fields: [],
    };
    expect(
      credentialRequestText(
        call("request_credentials", { credentials, expiresAt: 60_000 }),
        "Bot",
        0,
      ),
    ).toEqual({
      title: "Bot needs you on x.com",
      description:
        "Sign in. What you type is filled into the page and never shown to Bot. Expires in 1 minute.",
    });
  });

  it("rounds expiry up and never below zero", () => {
    expect(expiryText(undefined)).toBe("");
    expect(expiryText(1, 0)).toBe(" Expires in 1 minute.");
    expect(expiryText(0, 5_000)).toBe(" Expires in 0 minutes.");
  });
});

describe("approval note", () => {
  it.each([
    [undefined, undefined, undefined],
    ["denied by you", "denied", "denied by you"],
    ["nobody answered in time", "approved", "nobody answered in time · approved by you"],
    [undefined, "approved", ""],
    [undefined, "auto", "auto-approved"],
    ["stopped", "auto", "stopped · auto-approved"],
    [undefined, "yolo", "auto-approved (YOLO)"],
    ["stopped", "yolo", "stopped · auto-approved (YOLO)"],
    [undefined, "refused", undefined],
  ] as const)("%s + %s → %s", (note, approval, expected) => {
    expect(approvalNote(note, approval)).toBe(expected);
  });
});

describe("durations", () => {
  it("formats a step's time", () => {
    expect(formatDuration(0)).toBe("1ms");
    expect(formatDuration(340.4)).toBe("340ms");
    expect(formatDuration(1234)).toBe("1.2s");
    expect(formatDuration(125_000)).toBe("125.0s");
  });

  it("formats an Owner wait like a person would", () => {
    expect(formatWait(200)).toBe("1s");
    expect(formatWait(40_000)).toBe("40s");
    expect(formatWait(100_000)).toBe("1m 40s");
    expect(formatWait(120_000)).toBe("2m");
    expect(formatWait(7_500_000)).toBe("2h 5m");
    expect(formatWait(7_200_000)).toBe("2h");
  });

  it("adds the wait to a finished call's time", () => {
    expect(durationText(call("x"))).toBeUndefined();
    expect(durationText(call("x", { durationMs: 1234 }))).toBe("1.2s");
    expect(durationText(call("x", { durationMs: 1234, waitedMs: 40_000 }))).toBe(
      "1.2s · waited 40s for you",
    );
  });
});

describe("folding finished calls", () => {
  it("folds runs of two or more finished plain calls; the rest stay rows", () => {
    const calls = [
      call("web_search"),
      call("web_search", { status: "error" }),
      call("browser_navigate", { status: "running" }),
      call("web_search"),
      call("message_bot"),
      call("web_search"),
      call("web_search", { status: "denied" }),
      call("load_skill"),
    ];
    expect(toolSteps(calls).map((step) => [step.kind, step.i])).toEqual([
      ["group", 0],
      ["call", 2],
      ["call", 3],
      ["call", 4],
      ["group", 5],
    ]);
  });

  it("describes a run by label, counting repeats", () => {
    const calls = [
      call("web_search"),
      call("browser_navigate"),
      call("web_search"),
      call("load_skill"),
      call("mcp__linear__create_issue"),
    ];
    expect(describeCalls(calls, labels)).toBe(
      "Searched the web ×2, opened a page, used a skill, create Issue via linear",
    );
  });

  it("counts a run's failures and adds up its time", () => {
    const calls = [
      call("web_search", { durationMs: 100 }),
      call("web_search", { status: "error", durationMs: 250 }),
      call("web_search", { status: "expired" }),
    ];
    expect(groupText(calls, labels)).toEqual({
      title: "Searched the web ×3",
      failed: "· 2 failed",
      duration: "350ms",
    });
    expect(groupText([call("web_search"), call("web_search")], labels)).toEqual({
      title: "Searched the web ×2",
    });
  });
});
