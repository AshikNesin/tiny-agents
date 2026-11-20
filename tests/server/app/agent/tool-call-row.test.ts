import { describe, expect, it } from "vite-plus/test";
import {
  finishedToolRow,
  liveToolRow,
  type LiveTool,
  type ToolCallRow,
  type ToolOutcome,
} from "../../../../packages/agent/src/tool-call-row";
import type { ChatCredentialRequest, ChatVaultUse } from "../../../../packages/agent/src/types";

const vault: ChatVaultUse = {
  handle: "card-1",
  label: "Visa",
  kind: "card",
  tool: "pay_invoice",
  target: "https://shop.dev",
  grantable: false,
};
const questions = [{ question: "Which repo?", options: [{ label: "web" }, { label: "api" }] }];
const answers = [{ selected: ["web"] }];
const request = {
  origin: "https://shop.dev",
  title: "Shop login",
  purpose: "Sign in to check the order",
  fields: [{ key: "username", label: "Username", type: "text", required: true }],
};
const credentialCard = (status: ChatCredentialRequest["status"]): ChatCredentialRequest => ({
  status,
  origin: request.origin,
  title: request.title,
  purpose: request.purpose,
  fields: request.fields,
});
const code = {
  threadId: "t-1",
  harness: "Claude Code",
  title: "Fix the build",
  cwd: "/work",
  url: "/code/t-1",
};

const finished: [string, ToolOutcome, ToolCallRow][] = [
  ["done", { output: "ok", durationMs: 40 }, { status: "done", output: "ok", durationMs: 40 }],
  ["done without a clock (Claude plan)", { output: "ok" }, { status: "done", output: "ok" }],
  ["error", { output: "boom", isError: true }, { status: "error", output: "boom" }],
  [
    "denied, with the wait",
    { output: "The owner denied", isError: true, details: { approval: "denied", waitedMs: 900 } },
    { status: "denied", output: "The owner denied", waitedMs: 900, approval: "denied" },
  ],
  [
    "expired approval",
    { output: "Nobody answered", isError: true, details: { approval: "expired", waitedMs: 5 } },
    { status: "expired", output: "Nobody answered", waitedMs: 5 },
  ],
  [
    "expired credential request",
    { output: "Nobody filled it", details: { credentials: "expired", request } },
    { status: "expired", output: "Nobody filled it", credentials: credentialCard("expired") },
  ],
  [
    "interrupted by a restart (the gate's memo)",
    { output: "may have run", isError: true, details: { interrupted: true, approval: "approved" } },
    { status: "interrupted", output: "may have run", approval: "approved" },
  ],
  [
    "interrupted (pi-durable diagnostic)",
    { output: "", diagnostics: [{ code: "interrupted", message: "Cut off by a restart" }] },
    { status: "interrupted", output: "Cut off by a restart" },
  ],
  [
    "aborted",
    { output: "", isError: true, diagnostics: [{ code: "aborted" }] },
    { status: "aborted" },
  ],
  [
    "approved: the run and the wait apart",
    { output: "Sent", durationMs: 1_000, details: { approval: "approved", waitedMs: 700 } },
    { status: "done", output: "Sent", durationMs: 300, waitedMs: 700, approval: "approved" },
  ],
  [
    "a wait longer than the clock never goes negative",
    { output: "Sent", durationMs: 100, details: { approval: "approved", waitedMs: 700 } },
    { status: "done", output: "Sent", durationMs: 0, waitedMs: 700, approval: "approved" },
  ],
  [
    "YOLO",
    { output: "Sent", details: { approval: "yolo", result: null } },
    { status: "done", output: "Sent", approval: "yolo" },
  ],
  [
    "auto-review",
    { output: "Sent", details: { approval: "auto", review: { approve: true }, result: null } },
    { status: "done", output: "Sent", approval: "auto" },
  ],
  [
    "refused while unattended",
    { output: "Nobody is here", isError: true, details: { approval: "refused" } },
    { status: "error", output: "Nobody is here", approval: "refused" },
  ],
  [
    "web search sources, under an approval",
    {
      output: "found",
      details: {
        approval: "approved",
        waitedMs: 0,
        result: { sources: [{ url: "https://a.dev", title: "A", extra: 1 }, { url: 3 }] },
      },
    },
    {
      status: "done",
      output: "found",
      approval: "approved",
      sources: [{ url: "https://a.dev", title: "A" }],
    },
  ],
  [
    "a Code hand-off",
    { output: "Started", details: { code } },
    { status: "done", output: "Started", code },
  ],
  [
    "a legacy Shelley hand-off",
    { output: "Started", details: { shelley: { conversationId: "c9", slug: "fix", url: "/s" } } },
    {
      status: "done",
      output: "Started",
      code: { threadId: "shelley:c9", harness: "Shelley", title: "fix", cwd: null, url: "/s" },
    },
  ],
  [
    "an answered Question",
    { output: "Which repo?: web", details: { question: "answered", questions, answers } },
    { status: "done", output: "Which repo?: web", questions, answers },
  ],
  [
    "a dismissed Question",
    { output: "dismissed", details: { question: "dismissed", questions } },
    { status: "done", output: "dismissed", questions },
  ],
  [
    "a filled credential request",
    {
      output: "Saved",
      details: { credentials: "filled", request, filled: ["username"], savedHandle: "login-1" },
    },
    {
      status: "done",
      output: "Saved",
      credentials: { ...credentialCard("filled"), filled: ["username"], savedHandle: "login-1" },
    },
  ],
  [
    "a released takeover, under an approval",
    {
      output: "Back",
      details: {
        approval: "approved",
        waitedMs: 0,
        result: { takeover: { status: "released", reason: "Solve the captcha" } },
      },
    },
    {
      status: "done",
      output: "Back",
      approval: "approved",
      takeover: { status: "released", reason: "Solve the captcha" },
    },
  ],
];

const live: [string, LiveTool, ToolCallRow][] = [
  ["queued", { status: "pending" }, { status: "pending" }],
  [
    "running, with partial output",
    { status: "running", taskId: 7, output: "half" },
    { status: "running", taskId: 7, output: "half" },
  ],
  [
    "awaiting approval, with the vault card and its deadline",
    {
      status: "running",
      taskId: 7,
      details: { approval: "pending", vault, expiresAt: 1_000 },
    },
    { status: "awaiting_approval", taskId: 7, vault, expiresAt: 1_000 },
  ],
  [
    "awaiting an answer",
    { status: "running", taskId: 7, details: { question: "pending", questions } },
    { status: "awaiting_answer", taskId: 7, questions },
  ],
  [
    "awaiting credentials, with their deadline",
    {
      status: "running",
      taskId: 7,
      details: { credentials: "pending", request, expiresAt: 2_000 },
    },
    {
      status: "awaiting_credentials",
      taskId: 7,
      credentials: credentialCard("pending"),
      expiresAt: 2_000,
    },
  ],
  [
    "awaiting a takeover",
    {
      status: "running",
      taskId: 7,
      details: { takeover: { status: "pending", reason: "Solve the captcha" } },
    },
    {
      status: "awaiting_takeover",
      taskId: 7,
      takeover: { status: "pending", reason: "Solve the captcha" },
    },
  ],
  [
    "running once the approval is decided",
    { status: "running", taskId: 7, details: { approval: "approved", waitedMs: 3, result: null } },
    { status: "running", taskId: 7 },
  ],
];

describe("a finished tool call's row", () => {
  it.each(finished)("%s", (_, outcome, row) => {
    expect(finishedToolRow(outcome)).toEqual(row);
  });

  it("marks a call the gate refused for a run limit", () => {
    expect(
      finishedToolRow({ output: "no", isError: true, details: { runCap: { limit: 150 } } }),
    ).toMatchObject({ limit: "runCap" });
    expect(
      finishedToolRow({
        output: "no",
        isError: true,
        details: { budget: { used: 600_000, limit: 500_000 } },
      }),
    ).toMatchObject({ limit: "budget" });
  });

  it("keeps a long output bounded", () => {
    const row = finishedToolRow({ output: "x".repeat(5_000) });
    expect(row.output).toHaveLength(4_001);
    expect(row.output?.endsWith("…")).toBe(true);
  });
});

describe("a running tool call's row", () => {
  it.each(live)("%s", (_, slot, row) => {
    expect(liveToolRow(slot)).toEqual(row);
  });
});
