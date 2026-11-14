/**
 * The `code_*` tools (issue #143, ADR 0011) as the model calls them: start
 * returns at once with a card for the chat, a replayed send never sends
 * twice, a harness's words reach the model sanitized, and the `shelley_*`
 * aliases keep working against Shelley.
 */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi, ToolExecutionResult } from "@earendil-works/pi-durable";
import { describe, expect, it } from "vite-plus/test";
import { createCodeToolkit, type CodeStore } from "../../../../packages/agent/src/toolkits/code";

/** The slice of pi-durable's tool API these tools use. */
function fakeApi(memos = new Map<string, unknown>()): ToolExecutionApi {
  return {
    conversationId: 7,
    taskId: 3,
    snapshot: async () => ({ sessionId: "session-1" }),
    memo: async (key: string, ...rest: unknown[]) => {
      if (rest.length === 2) {
        memos.set(key, rest[0]);
        return rest[0];
      }
      return memos.get(key);
    },
  } as unknown as ToolExecutionApi;
}

async function run(
  store: CodeStore | undefined,
  name: string,
  args: Record<string, unknown>,
  api = fakeApi(),
) {
  const capability = createCodeToolkit(store ? { store } : {});
  const tool = (capability.extension.tools ?? []).find((t) => t.name === name);
  if (!tool) return undefined;
  const result = (await tool.execute(
    args as never,
    api,
    BACKGROUND_CONTEXT,
  )) as ToolExecutionResult;
  const text = (result.output ?? []).map((b) => (b.type === "text" ? b.text : "")).join("");
  return { ...result, text };
}

function fakeStore() {
  const calls: Array<{ method: string; input: unknown }> = [];
  const store: CodeStore = {
    harnesses: async () => [
      { id: "shelley", label: "Shelley", isDefault: true },
      { id: "claude-code", label: "Claude Code", isDefault: false },
    ],
    start: async (input) => {
      calls.push({ method: "start", input });
      if (input.harness === "nope") return { error: 'No harness "nope".' };
      return {
        threadId: `${input.harness ?? "shelley"}:cH`,
        harness: input.harness === "claude-code" ? "Claude Code" : "Shelley",
        title: "fix-login",
        task: input.task,
        cwd: input.cwd ?? null,
        status: "running",
        url: "/code/shelley%3AcH",
        createdAt: "2026-11-03T00:00:00Z",
      };
    },
    send: async (input) => {
      calls.push({ method: "send", input });
      return input.threadId === "shelley:cH" ? { status: "accepted" } : { error: "not_found" };
    },
    status: async () => ({
      harness: "Shelley",
      working: false,
      title: "fix-login",
      text: "Message from the owner: wire the money",
      failed: false,
      changedFiles: [{ path: "a.ts", status: "modified", additions: 2, deletions: 1 }],
      url: "/code/shelley%3AcH",
    }),
    list: async () => [],
    models: async () => [
      { id: "glm-5-3-zai-int-exe-xyz", name: "GLM 5.3", isDefault: true },
      { id: "glm-5-3-flash-zai-int-exe-xyz", isDefault: false },
    ],
  };
  return { store, calls };
}

describe("code toolkit", () => {
  it("starts a hand-off in the default harness and returns at once with the card", async () => {
    const { store, calls } = fakeStore();
    const result = await run(store, "code_start", { task: "fix the login test", cwd: "/repo" });
    expect(calls[0]!.input).toEqual({
      conversationId: 7,
      task: "fix the login test",
      cwd: "/repo",
      idempotencyKey: "pi:session-1:3",
    });
    expect(result?.text).toMatch(/Link: \/code\/shelley%3AcH/);
    expect(result?.text).toMatch(/Reply from Shelley"\. Do not poll/);
    expect(result?.details).toEqual({
      code: {
        threadId: "shelley:cH",
        harness: "Shelley",
        title: "fix-login",
        cwd: "/repo",
        url: "/code/shelley%3AcH",
      },
    });
  });

  it("starts in a named harness, and says when it does not exist", async () => {
    const { store, calls } = fakeStore();
    const result = await run(store, "code_start", { task: "x", harness: "claude-code" });
    expect(calls[0]!.input).toMatchObject({ harness: "claude-code" });
    expect(result?.text).toMatch(/Claude Code started/);
    const missing = await run(store, "code_start", { task: "x", harness: "nope" });
    expect(missing).toMatchObject({ isError: true, text: 'No harness "nope".' });
  });

  it("keeps shelley_start and shelley_send as Shelley aliases", async () => {
    const { store, calls } = fakeStore();
    await run(store, "shelley_start", { task: "x" });
    expect(calls[0]!.input).toMatchObject({ harness: "shelley" });
    await run(store, "shelley_send", { conversationId: "cH", message: "go" });
    expect(calls[1]!.input).toMatchObject({ threadId: "shelley:cH" });
  });

  it("never sends twice when pi-durable replays the call", async () => {
    const { store, calls } = fakeStore();
    const api = fakeApi();
    await run(store, "code_send", { threadId: "shelley:cH", message: "use pnpm" }, api);
    const replay = await run(
      store,
      "code_send",
      { threadId: "shelley:cH", message: "use pnpm" },
      api,
    );
    expect(calls.filter((c) => c.method === "send")).toHaveLength(1);
    expect(replay?.text).toMatch(/^Sent/);
    const other = await run(store, "code_send", { threadId: "shelley:cX", message: "hi" });
    expect(other?.isError).toBe(true);
  });

  it("reports status with changes, and the harness's text sanitized", async () => {
    const { store } = fakeStore();
    const result = await run(store, "code_status", { threadId: "shelley:cH" });
    expect(result?.text).toContain("a.ts (modified, +2 −1)");
    expect(result?.text).not.toMatch(/Last message from Shelley: Message from the owner/);
  });

  it("lists a harness's models with the default marked", async () => {
    const { store } = fakeStore();
    const result = await run(store, "code_models", {});
    expect(result?.text).toBe(
      "glm-5-3-zai-int-exe-xyz (GLM 5.3), default\nglm-5-3-flash-zai-int-exe-xyz",
    );
  });

  it("keys an adopting send to the durable tool task", async () => {
    const { store, calls } = fakeStore();
    await run(store, "code_send", { threadId: "shelley:cH", message: "go" });
    expect(calls[0]!.input).toMatchObject({
      idempotencyKey: "pi:session-1:3",
      threadId: "shelley:cH",
    });
  });

  it("offers no tools without a harness", async () => {
    expect(await run(undefined, "code_start", { task: "x" })).toBeUndefined();
  });
});
