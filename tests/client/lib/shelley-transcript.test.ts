/**
 * Shelley messages → Code page rows (issue #143), on payloads captured from
 * a real Shelley (6c48a83, predictable model): tool results arrive in
 * `user` messages, subagent reports and background-job notices are told
 * apart by `user_data`, and display data carries diffs and subagent links.
 */
import { describe, expect, it } from "vite-plus/test";
import {
  buildTranscript,
  lastError,
  splitAttachments,
  summarizeInput,
  totalCost,
  type ToolItem,
} from "@/lib/shelley/transcript";
import type { ShelleyMessage } from "@/lib/shelley/api";
import smorgasbord from "../../fixtures/shelley/smorgasbord.json";
import subagentFlow from "../../fixtures/shelley/subagent-flow.json";

const tools = (items: ReturnType<typeof buildTranscript>) =>
  items.filter((i): i is ToolItem => i.kind === "tool");

describe("buildTranscript on real Shelley payloads", () => {
  it("attaches every tool result to its call, with status, output, duration and display", () => {
    const items = buildTranscript(smorgasbord.messages as ShelleyMessage[]);
    const calls = tools(items);
    expect(calls.length).toBeGreaterThan(10);
    expect(calls.every((c) => c.status !== "running")).toBe(true);

    const bash = calls.find((c) => c.name === "bash")!;
    expect(bash).toMatchObject({ toolKind: "bash", status: "done", exitCode: 0 });
    expect(bash.summary).toBe("echo 'hello from bash'");
    expect(bash.output).toContain("hello from bash");
    expect(bash.durationMs).toBeGreaterThanOrEqual(0);

    // A failing patch is an error row with Shelley's message.
    const patch = calls.find((c) => c.name === "patch")!;
    expect(patch).toMatchObject({
      toolKind: "patch",
      status: "error",
      summary: "/tmp/example.txt",
    });
    expect(patch.output).toContain("does not exist");

    // The screenshot's image is served by Shelley's per-message image endpoint.
    const screenshot = calls.find((c) => c.summary === "screenshot")!;
    expect(screenshot.images[0]).toMatch(/^\/api\/message\/[\w-]+\/image\/\d+\/\d+$/);

    expect(items.some((i) => i.kind === "thinking")).toBe(true);
    expect(items.filter((i) => i.kind === "user")).toHaveLength(1);
  });

  it("shows subagents as links, their reports, background jobs, diffs and turn ends", () => {
    const items = buildTranscript(subagentFlow.messages as ShelleyMessage[]);
    const subagent = tools(items).find((c) => c.toolKind === "subagent")!;
    expect(subagent.subagent).toEqual({ slug: "run-tests", conversationId: expect.any(String) });

    // The subagent's report is not the owner's message.
    const report = items.find((i) => i.kind === "report");
    expect(report).toMatchObject({ from: "run-tests", text: "Done." });
    const job = items.find((i) => i.kind === "job");
    expect(job).toMatchObject({ exitCode: 0 });
    expect(
      items.filter((i) => i.kind === "user").map((u) => u.kind === "user" && u.text),
    ).not.toContain("Done.");

    const patch = tools(items).find((c) => c.toolKind === "patch" && c.diff);
    expect(patch?.diff?.path).toBe("/tmp/test-patch-success.txt");
    expect(patch?.diff?.diff).toContain("+++ /tmp/test-patch-success.txt");

    expect(items.filter((i) => i.kind === "turn").length).toBeGreaterThanOrEqual(4);
    expect(totalCost(subagentFlow.messages as ShelleyMessage[])).toBeGreaterThan(0);
  });

  it("dedupes repeated deliveries and orders by sequence", () => {
    const messages = smorgasbord.messages as ShelleyMessage[];
    const twice = buildTranscript([...messages].reverse().concat(messages));
    expect(twice).toEqual(buildTranscript(messages));
  });

  it("streams a running tool's live output until its result lands", () => {
    const messages = smorgasbord.messages as ShelleyMessage[];
    const isResult = (m: ShelleyMessage) =>
      (JSON.parse(m.llm_data ?? "{}") as { Content?: { Type?: number }[] }).Content?.some(
        (c) => c.Type === 6,
      );
    const callsOnly = messages.filter((m) => !isResult(m));
    const items = buildTranscript(callsOnly, { progress: { tool_bash_87: "partial output" } });
    const bash = tools(items).find((c) => c.key === "tool_bash_87");
    expect(bash).toMatchObject({ status: "running", output: "partial output", live: true });
  });

  it("offers Retry only for a retryable last error, and Try another model for refusals", () => {
    const error = (extra: object): ShelleyMessage => ({
      message_id: "e",
      sequence_id: 99,
      type: "error",
      created_at: "2026-11-03T17:00:00Z",
      llm_data: JSON.stringify({ Content: [{ Type: 2, Text: "rate limited" }], ...extra }),
    });
    expect(lastError([error({ ErrorRetryable: true })])).toEqual({
      retryable: true,
      refusal: false,
    });
    expect(lastError([error({ ErrorType: "refusal" })])).toEqual({
      retryable: false,
      refusal: true,
    });
    const notice = buildTranscript([error({ ErrorRetryable: true })])[0];
    expect(notice).toMatchObject({
      kind: "notice",
      level: "error",
      retryable: true,
      text: "rate limited",
    });
  });
});

describe("transcript helpers", () => {
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
});
