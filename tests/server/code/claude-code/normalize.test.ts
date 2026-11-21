import { describe, expect, it } from "vite-plus/test";
import {
  diffFromInput,
  diffFromPatch,
  normalizeEntries,
  splitAttachments,
  toolKindOf,
  usageLimitOf,
  type ClaudeEntry,
} from "../../../../packages/code/src/drivers/claude-code/normalize";
import { ATTACHMENTS_HEADER } from "../../../../packages/claude-worker/src/index";

const SESSION = "6f1c2a0e-9b7d-4f7e-8a51-2d3c4b5a6f70";

const LIVE: ClaudeEntry[] = [
  {
    type: "user",
    uuid: "u-1",
    session_id: SESSION,
    parent_tool_use_id: null,
    message: { role: "user", content: "Rename foo to bar in src/a.ts" },
  },
  {
    type: "assistant",
    uuid: "a-1",
    session_id: SESSION,
    parent_tool_use_id: null,
    message: {
      id: "msg_01",
      type: "message",
      role: "assistant",
      model: "claude-opus-4-7",
      content: [
        { type: "thinking", thinking: "The user wants a rename.", signature: "sig" },
        { type: "text", text: "I'll make the edit." },
        {
          type: "tool_use",
          id: "toolu_edit",
          name: "Edit",
          input: { file_path: "/repo/src/a.ts", old_string: "foo", new_string: "bar" },
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 20 },
    },
  },
  {
    type: "user",
    uuid: "u-2",
    session_id: SESSION,
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_edit",
          content: "The file /repo/src/a.ts has been updated.",
        },
      ],
    },
    tool_use_result: {
      filePath: "/repo/src/a.ts",
      oldString: "foo",
      newString: "bar",
      originalFile: "const foo = 1;\n",
      structuredPatch: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: ["-const foo = 1;", "+const bar = 1;"],
        },
      ],
      userModified: false,
      replaceAll: false,
    },
  },
  {
    type: "assistant",
    uuid: "a-2",
    session_id: SESSION,
    parent_tool_use_id: null,
    message: {
      id: "msg_02",
      role: "assistant",
      model: "claude-opus-4-7",
      content: [{ type: "text", text: "Done: foo is now bar." }],
    },
  },
  {
    type: "assistant",
    uuid: "sub-1",
    session_id: SESSION,
    parent_tool_use_id: "toolu_task",
    message: { role: "assistant", content: [{ type: "text", text: "subagent chatter" }] },
  },
  {
    type: "result",
    subtype: "success",
    uuid: "r-1",
    session_id: SESSION,
    duration_ms: 4200,
    total_cost_usd: 0.05,
    turn_cost_usd: 0.012,
    is_error: false,
    num_turns: 2,
    result: "Done: foo is now bar.",
    after_uuid: "a-2",
  },
];

describe("normalizeEntries", () => {
  it("turns a live turn into user, thinking, assistant, tool, assistant and turn rows", () => {
    const items = normalizeEntries(LIVE);
    expect(items.map((item) => `${item.kind}:${item.id}`)).toEqual([
      "user:u-1:0",
      "thinking:a-1:0",
      "assistant:a-1:1",
      "tool:toolu_edit",
      "assistant:a-2:0",
      "turn:r-1",
    ]);
    const user = items[0]!;
    expect(user).toMatchObject({
      kind: "user",
      text: "Rename foo to bar in src/a.ts",
      forkAt: "u-1",
    });
    const tool = items[3]!;
    expect(tool).toMatchObject({
      kind: "tool",
      tool: "edit",
      name: "Edit",
      status: "done",
      summary: "/repo/src/a.ts",
      output: "The file /repo/src/a.ts has been updated.",
    });
    if (tool.kind !== "tool") throw new Error("not a tool");
    expect(tool.diff?.diff).toContain("@@ -1,1 +1,1 @@\n-const foo = 1;\n+const bar = 1;");
    expect(items.at(-1)).toEqual({ kind: "turn", id: "r-1", durationMs: 4200, costUsd: 0.012 });
  });

  it("gives history entries the same ids as the live stream", () => {
    const history: ClaudeEntry[] = LIVE.filter((entry) => entry.type !== "result").map(
      ({ tool_use_result: _drop, ...entry }) => entry,
    );
    const live = normalizeEntries(LIVE).filter((item) => item.kind !== "turn");
    const replayed = normalizeEntries(history);
    expect(replayed.map((item) => item.id)).toEqual(live.map((item) => item.id));
    const tool = replayed.find((item) => item.kind === "tool");
    if (tool?.kind !== "tool") throw new Error("no tool");
    expect(tool.diff?.diff).toContain("-foo\n+bar");
  });

  it("maps tool names to kinds", () => {
    expect(toolKindOf("Bash")).toBe("bash");
    expect(toolKindOf("Write")).toBe("edit");
    expect(toolKindOf("MultiEdit")).toBe("edit");
    expect(toolKindOf("NotebookEdit")).toBe("edit");
    expect(toolKindOf("Read")).toBe("read");
    expect(toolKindOf("Grep")).toBe("search");
    expect(toolKindOf("Glob")).toBe("search");
    expect(toolKindOf("WebFetch")).toBe("web");
    expect(toolKindOf("WebSearch")).toBe("web");
    expect(toolKindOf("TodoWrite")).toBe("todo");
    expect(toolKindOf("Task")).toBe("subagent");
    expect(toolKindOf("Agent")).toBe("subagent");
    expect(toolKindOf("mcp__github__create_issue")).toBe("mcp");
    expect(toolKindOf("ExitPlanMode")).toBe("other");
  });

  it("builds diffs from Write and MultiEdit input", () => {
    expect(diffFromInput("Write", { file_path: "/r/new.ts", content: "a\nb\n" })).toEqual({
      path: "/r/new.ts",
      diff: "--- /dev/null\n+++ /r/new.ts\n@@ -0,0 +1,2 @@\n+a\n+b",
    });
    const multi = diffFromInput("MultiEdit", {
      file_path: "/r/x.ts",
      edits: [
        { old_string: "a", new_string: "b" },
        { old_string: "c", new_string: "d" },
      ],
    });
    expect(multi?.diff).toContain("-a\n+b");
    expect(multi?.diff).toContain("-c\n+d");
    expect(
      diffFromPatch({ type: "create", filePath: "/r/n.ts", structuredPatch: [] }),
    ).toBeUndefined();
  });

  it("marks a Bash error, a tool cut off by the turn end, and a background command", () => {
    const items = normalizeEntries([
      {
        type: "assistant",
        uuid: "a",
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", id: "t1", name: "Bash", input: { command: "false\necho no" } },
            {
              type: "tool_use",
              id: "t2",
              name: "Bash",
              input: { command: "sleep 100", run_in_background: true },
            },
          ],
        },
      },
      {
        type: "user",
        uuid: "u",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", content: "exit 1", is_error: true }],
        },
      },
      { type: "result", uuid: "r", is_error: false, interrupted: true, duration_ms: 10 },
    ]);
    const [t1, t2] = items.filter((item) => item.kind === "tool");
    expect(t1).toMatchObject({ status: "error", summary: "false", output: "exit 1" });
    expect(t2).toMatchObject({ status: "error", background: true });
    expect(items.find((item) => item.kind === "notice")).toMatchObject({ text: "Stopped." });
  });

  it("turns API errors and usage limits into notices, live and from history", () => {
    const live = normalizeEntries([
      {
        type: "assistant",
        uuid: "e1",
        error: "rate_limit",
        message: {
          role: "assistant",
          model: "<synthetic>",
          content: [{ type: "text", text: "Claude AI usage limit reached|1762365600" }],
        },
      },
      { type: "result", uuid: "r1", is_error: true, errors: ["rate limited"], duration_ms: 1 },
    ]);
    expect(live[0]).toMatchObject({
      kind: "notice",
      level: "error",
      code: "usage_limit",
      resetsAt: new Date(1762365600 * 1000).toISOString(),
      text: "Claude AI usage limit reached",
    });
    expect(live.filter((item) => item.kind === "notice")).toHaveLength(1);

    const fromWorker = normalizeEntries([
      {
        type: "result",
        uuid: "r2",
        is_error: true,
        errors: ["Stopped"],
        usage_limit: { reason: "rate limit status rejected", resetsAt: "2026-11-05T18:00:00.000Z" },
      },
    ]);
    expect(fromWorker[0]).toMatchObject({
      kind: "notice",
      code: "usage_limit",
      resetsAt: "2026-11-05T18:00:00.000Z",
    });
    expect(usageLimitOf("You've hit your limit · resets 3pm")).toEqual({});
    expect(usageLimitOf("5-hour limit reached ∙ resets 3pm")).toEqual({});
    expect(usageLimitOf("Here is the refactor you asked for.")).toBeUndefined();

    const auth = normalizeEntries([
      {
        type: "assistant",
        uuid: "e2",
        message: {
          role: "assistant",
          model: "<synthetic>",
          content: [{ type: "text", text: "Invalid API key · Please run /login" }],
        },
      },
    ]);
    expect(auth[0]).toMatchObject({ kind: "notice", code: "auth" });
  });

  it("shows compaction and slash commands, and hides caveats", () => {
    const items = normalizeEntries([
      {
        type: "user",
        uuid: "c1",
        message: {
          role: "user",
          content:
            "<local-command-caveat>Caveat: generated by local commands.</local-command-caveat>",
        },
      },
      {
        type: "user",
        uuid: "c2",
        message: {
          role: "user",
          content:
            "<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>",
        },
      },
      {
        type: "system",
        subtype: "compact_boundary",
        uuid: "b1",
        compact_metadata: { trigger: "manual", pre_tokens: 154000 },
      },
      {
        type: "user",
        uuid: "s1",
        message: {
          role: "user",
          content:
            "This session is being continued from a previous conversation that ran out of context. Summary: …",
        },
      },
      {
        type: "user",
        uuid: "o1",
        message: {
          role: "user",
          content: "<local-command-stdout>Compacted</local-command-stdout>",
        },
      },
    ]);
    expect(items.map((item) => [item.kind, "text" in item ? item.text : ""])).toEqual([
      ["user", "/compact"],
      ["notice", "Context compacted (154,000 tokens before)."],
      ["notice", "Earlier conversation was compacted."],
      ["notice", "Compacted"],
    ]);
  });

  it("splits attachments back out of a prompt", () => {
    const prompt = `Look at this\n\n${ATTACHMENTS_HEADER}\n- /home/u/.tiny-agents/uploads/x/shot.png\n- /home/u/.tiny-agents/uploads/y/log.txt`;
    expect(splitAttachments(prompt)).toEqual({
      text: "Look at this",
      attachments: [
        { ref: "/home/u/.tiny-agents/uploads/x/shot.png", name: "shot.png", image: true },
        { ref: "/home/u/.tiny-agents/uploads/y/log.txt", name: "log.txt", image: false },
      ],
    });
    const [user] = normalizeEntries([
      { type: "user", uuid: "p", message: { role: "user", content: prompt } },
    ]);
    expect(user).toMatchObject({ kind: "user", text: "Look at this" });
  });

  it("places approval requests after their tool and marks a denied tool", () => {
    const entries: ClaudeEntry[] = [
      {
        type: "assistant",
        uuid: "a",
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", id: "toolu_rm", name: "Bash", input: { command: "rm -rf build" } },
          ],
        },
      },
      {
        type: "assistant",
        uuid: "b",
        message: { role: "assistant", content: [{ type: "text", text: "Waiting." }] },
      },
    ];
    const items = normalizeEntries(entries, {
      requests: [
        {
          approvalId: "apr_1",
          toolUseId: "toolu_rm",
          toolName: "Bash",
          input: { command: "rm -rf build" },
          reason: "Bash commands need approval",
          status: "denied",
        },
        {
          approvalId: "apr_2",
          toolName: "AskUserQuestion",
          input: {
            questions: [
              {
                question: "Which database?",
                header: "DB",
                multiSelect: false,
                options: [
                  { label: "SQLite", description: "Local file" },
                  { label: "Postgres", description: "Server" },
                ],
              },
            ],
          },
          status: "open",
        },
      ],
    });
    expect(items.map((item) => item.id)).toEqual(["toolu_rm", "apr_1", "b:0", "apr_2"]);
    expect(items[0]).toMatchObject({ status: "denied" });
    expect(items[1]).toMatchObject({
      kind: "request",
      status: "denied",
      request: {
        kind: "tool",
        tool: "bash",
        summary: "rm -rf build",
        reason: "Bash commands need approval",
      },
    });
    expect(items[3]).toMatchObject({
      kind: "request",
      status: "open",
      request: {
        kind: "question",
        questions: [
          {
            question: "Which database?",
            header: "DB",
            multiSelect: false,
            options: [
              { label: "SQLite", description: "Local file" },
              { label: "Postgres", description: "Server" },
            ],
          },
        ],
      },
    });
  });
});
