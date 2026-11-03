import { describe, expect, it } from "vite-plus/test";
import { buildTranscript, type ShelleyMessage } from "@/lib/shelley-api";

let seq = 0;
function message(type: string, content: unknown[]): ShelleyMessage {
  seq += 1;
  return {
    message_id: `m${seq}`,
    sequence_id: seq,
    type,
    created_at: "2026-11-03T10:00:00Z",
    llm_data: JSON.stringify({ Role: type === "agent" ? 1 : 0, Content: content }),
  };
}

describe("buildTranscript (Shelley messages → Code page rows)", () => {
  const user = message("user", [{ Type: 2, Text: "fix the tests" }]);
  const agent = message("agent", [
    { Type: 3, Thinking: "Look at the runner first." },
    { Type: 2, Text: "Running them." },
    { Type: 5, ID: "tu1", ToolName: "bash", ToolInput: { command: "pnpm test\n--watch" } },
  ]);
  const result = message("tool", [
    {
      Type: 6,
      ToolUseID: "tu1",
      ToolError: true,
      ToolResult: [{ Type: 2, Text: "1 failed" }],
      ToolUseStartTime: "2026-11-03T10:00:00Z",
      ToolUseEndTime: "2026-11-03T10:00:02.5Z",
    },
  ]);
  const system = message("system", [{ Type: 2, Text: "You are Shelley" }]);

  it("orders by sequence, skips system rows and attaches results to their call", () => {
    const items = buildTranscript([result, system, agent, user, user]);
    expect(items.map((i) => i.kind)).toEqual(["user", "user", "thinking", "assistant", "tool"]);
    expect(items[4]).toMatchObject({
      name: "bash",
      summary: "pnpm test",
      status: "error",
      output: "1 failed",
      durationMs: 2500,
    });
  });

  it("shows a running tool's live output until its result lands", () => {
    const items = buildTranscript([user, agent], { tu1: "PASS a.test.ts" });
    expect(items.at(-1)).toMatchObject({ status: "running", output: "PASS a.test.ts" });
  });

  it("surfaces error messages as notices and tolerates bad llm_data", () => {
    const error = message("error", [{ Type: 2, Text: "rate limited" }]);
    const broken = { ...message("agent", []), llm_data: "{not json" };
    expect(buildTranscript([error, broken])).toEqual([
      { kind: "notice", key: error.message_id, text: "rate limited" },
    ]);
  });
});
