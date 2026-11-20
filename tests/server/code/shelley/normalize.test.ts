import { describe, expect, it } from "vite-plus/test";
import type { ToolItem } from "@tiny-agents/code/contracts";
import {
  assetFromUrl,
  assetPath,
  buildTranscript,
  lastWriteAt,
  messageUserText,
  queuedMessages,
  splitAttachments,
  summarizeInput,
  totalCost,
} from "../../../../packages/code/src/drivers/shelley/normalize";
import type { ShelleyMessage } from "../../../../packages/code/src/drivers/shelley/wire";
import smorgasbord from "../../../fixtures/shelley/smorgasbord.json";
import subagentFlow from "../../../fixtures/shelley/subagent-flow.json";

const tools = (items: ReturnType<typeof buildTranscript>) =>
  items.filter((i): i is ToolItem => i.kind === "tool");

describe("buildTranscript on real Shelley payloads", () => {
  it("attaches every tool result to its call, with status, output, duration and display", () => {
    const items = buildTranscript(smorgasbord.messages as ShelleyMessage[], "shelley");
    const calls = tools(items);
    expect(calls.length).toBeGreaterThan(10);
    expect(calls.every((c) => c.status !== "running")).toBe(true);

    const bash = calls.find((c) => c.name === "bash")!;
    expect(bash).toMatchObject({ tool: "bash", status: "done", exitCode: 0 });
    expect(bash.summary).toBe("echo 'hello from bash'");
    expect(bash.output).toContain("hello from bash");
    expect(bash.durationMs).toBeGreaterThanOrEqual(0);

    const patch = calls.find((c) => c.name === "patch")!;
    expect(patch).toMatchObject({ tool: "edit", status: "error", summary: "/tmp/example.txt" });
    expect(patch.output).toContain("does not exist");

    const screenshot = calls.find((c) => c.summary === "screenshot")!;
    expect(screenshot.images[0]).toMatchObject({
      image: true,
      ref: expect.stringMatching(/^img:/),
    });
    expect(assetPath(screenshot.images[0]!.ref)).toMatch(/^\/message\/[\w-]+\/image\/\d+\/\d+$/);

    expect(items.some((i) => i.kind === "thinking")).toBe(true);
    const users = items.filter((i) => i.kind === "user");
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ forkAt: expect.any(String) });
  });

  it("shows subagents as thread links, their reports, background jobs, diffs and turn ends", () => {
    const items = buildTranscript(subagentFlow.messages as ShelleyMessage[], "shelley");
    const subagent = tools(items).find((c) => c.tool === "subagent")!;
    expect(subagent.child).toEqual({
      threadId: expect.stringMatching(/^shelley:/),
      title: "run-tests",
    });

    const report = items.find((i) => i.kind === "report");
    expect(report).toMatchObject({ from: "run-tests", text: "Done." });
    expect(items.find((i) => i.kind === "job")).toMatchObject({ exitCode: 0 });
    expect(
      items.filter((i) => i.kind === "user").map((u) => u.kind === "user" && u.text),
    ).not.toContain("Done.");

    const patch = tools(items).find((c) => c.tool === "edit" && c.diff);
    expect(patch?.diff?.path).toBe("/tmp/test-patch-success.txt");
    expect(patch?.diff?.diff).toContain("+++ /tmp/test-patch-success.txt");

    expect(items.filter((i) => i.kind === "turn").length).toBeGreaterThanOrEqual(4);
    expect(totalCost(subagentFlow.messages as ShelleyMessage[])).toBeGreaterThan(0);
  });

  it("dedupes repeated deliveries and orders by sequence", () => {
    const messages = smorgasbord.messages as ShelleyMessage[];
    const twice = buildTranscript([...messages].reverse().concat(messages), "shelley");
    expect(twice).toEqual(buildTranscript(messages, "shelley"));
  });

  it("streams a running tool's live output until its result lands", () => {
    const messages = smorgasbord.messages as ShelleyMessage[];
    const isResult = (m: ShelleyMessage) =>
      (JSON.parse(m.llm_data ?? "{}") as { Content?: { Type?: number }[] }).Content?.some(
        (c) => c.Type === 6,
      );
    const callsOnly = messages.filter((m) => !isResult(m));
    const items = buildTranscript(callsOnly, "shelley", {
      progress: { tool_bash_87: "partial output" },
    });
    const bash = tools(items).find((c) => c.id === "tool_bash_87");
    expect(bash).toMatchObject({ status: "running", output: "partial output", live: true });
  });

  it("marks retryable errors and refusals on the notice", () => {
    const error = (extra: object): ShelleyMessage => ({
      message_id: "e",
      sequence_id: 99,
      type: "error",
      created_at: "2026-11-03T17:00:00Z",
      llm_data: JSON.stringify({ Content: [{ Type: 2, Text: "rate limited" }], ...extra }),
    });
    expect(buildTranscript([error({ ErrorRetryable: true })], "shelley")[0]).toMatchObject({
      kind: "notice",
      level: "error",
      retryable: true,
      text: "rate limited",
    });
    expect(buildTranscript([error({ ErrorType: "refusal" })], "shelley")[0]).toMatchObject({
      refusal: true,
    });
    expect(lastWriteAt([error({})])).toBe(Date.parse("2026-11-03T17:00:00Z"));
  });

  it("shows a branch move by its branch, not the worktree's full path", () => {
    const gitinfo = (text: string): ShelleyMessage => ({
      message_id: "g",
      sequence_id: 7,
      type: "gitinfo",
      created_at: "2026-11-03T17:00:00Z",
      llm_data: JSON.stringify({ Content: [{ Type: 2, Text: text }] }),
    });
    const moved = gitinfo(
      '/tmp/ta-ws-GUAMeJ/tiny-agents-code/acme--web/worktrees/ta_echo-start (ta/echo-start) now at c803166 "Add b"',
    );
    expect(buildTranscript([moved], "shelley")[0]).toMatchObject({
      kind: "notice",
      level: "info",
      text: 'ta/echo-start now at c803166 "Add b"',
    });
    expect(buildTranscript([gitinfo("not a git repository")], "shelley")[0]).toMatchObject({
      text: "not a git repository",
    });
  });
});

describe("Shelley wire helpers", () => {
  it("summarizes tool inputs by what a developer looks for", () => {
    expect(summarizeInput("bash", { command: "pnpm test\n--watch" })).toBe("pnpm test");
    expect(summarizeInput("browser", { action: "navigate", url: "https://example.com" })).toBe(
      "navigate https://example.com",
    );
    expect(summarizeInput("subagent", { slug: "run-tests", prompt: "…" })).toBe("run-tests");
    expect(
      summarizeInput("apply_patch", { input: "*** Update File: a.ts\n*** Add File: b.ts\n" }),
    ).toBe("a.ts, b.ts");
  });

  it("splits uploaded-file tokens out of a message", () => {
    expect(splitAttachments("see this\n\n[/tmp/shelley-uploads/x.png] [/etc/passwd]")).toEqual({
      text: "see this\n\n [/etc/passwd]",
      attachments: ["/tmp/shelley-uploads/x.png"],
    });
  });

  it("serves only asset refs it made, and never a path with ..", () => {
    expect(assetFromUrl("/api/read?path=%2Ftmp%2Fshot.png")).toMatchObject({
      ref: "file:/tmp/shot.png",
      image: true,
    });
    expect(assetPath("file:/tmp/shot.png")).toBe("/read?path=%2Ftmp%2Fshot.png");
    expect(assetPath("file:/tmp/../etc/passwd")).toBeUndefined();
    expect(assetPath("img:m1:0:1")).toBe("/message/m1/image/0/1");
    expect(assetPath("img:m1:0:1/../x")).toBeUndefined();
    expect(assetPath("http://elsewhere")).toBeUndefined();
  });

  it("reads queued messages and message_user calls", () => {
    expect(
      queuedMessages({
        queued_messages: JSON.stringify([
          {
            id: "q1",
            created_at: "t",
            llm: { Content: [{ Type: 2, Text: "after this" }] },
            user_data: { sender_slug: "run-tests" },
          },
        ]),
      }),
    ).toEqual([{ id: "q1", text: "after this", createdAt: "t", from: "run-tests" }]);
    expect(queuedMessages({ queued_messages: "{bad" })).toEqual([]);
    expect(
      messageUserText(
        JSON.stringify({
          Content: [{ Type: 5, ToolName: "message_user", ToolInput: { text: "Need a key" } }],
        }),
      ),
    ).toBe("Need a key");
  });
});
