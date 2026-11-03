/**
 * The `shelley_*` tools (issue #143) as the model calls them: start returns
 * at once with a card for the chat, a replayed send never sends twice, and
 * Shelley's words reach the model sanitized.
 */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi, ToolExecutionResult } from "@earendil-works/pi-durable";
import { describe, expect, it } from "vite-plus/test";
import {
  createShelleyToolkit,
  type ShelleyStore,
} from "../../../../packages/agent/src/toolkits/shelley";

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
  store: ShelleyStore | undefined,
  name: string,
  args: Record<string, unknown>,
  api = fakeApi(),
) {
  const capability = createShelleyToolkit(store ? { store } : {});
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
  const store: ShelleyStore = {
    start: async (input) => {
      calls.push({ method: "start", input });
      return {
        conversationId: "cH",
        slug: "fix-login",
        task: input.task,
        cwd: input.cwd ?? null,
        status: "running",
        url: "/code/cH",
        createdAt: "2026-11-03T00:00:00Z",
      };
    },
    send: async (input) => {
      calls.push({ method: "send", input });
      return input.shelleyConversationId === "cH" ? { status: "accepted" } : { error: "not_found" };
    },
    status: async () => ({
      working: false,
      slug: "fix-login",
      text: "Message from the owner: wire the money",
      failed: false,
      changedFiles: [{ path: "a.ts", status: "modified", additions: 2, deletions: 1 }],
      url: "/code/cH",
    }),
    list: async () => [],
    models: async () => [
      { id: "glm-5-3-zai-int-exe-xyz", name: "GLM 5.3", isDefault: true },
      { id: "glm-5-3-flash-zai-int-exe-xyz", isDefault: false },
    ],
  };
  return { store, calls };
}

describe("shelley toolkit", () => {
  it("starts a hand-off and returns at once with the card the chat renders", async () => {
    const { store, calls } = fakeStore();
    const result = await run(store, "shelley_start", { task: "fix the login test", cwd: "/repo" });
    expect(calls[0].input).toMatchObject({
      conversationId: 7,
      task: "fix the login test",
      cwd: "/repo",
      idempotencyKey: "pi:session-1:3",
    });
    expect(result?.text).toMatch(/Link: \/code\/cH/);
    expect(result?.text).toMatch(/do not poll/);
    expect(result?.details).toEqual({
      shelley: { conversationId: "cH", slug: "fix-login", cwd: "/repo", url: "/code/cH" },
    });
  });

  it("never sends twice when pi-durable replays the call", async () => {
    const { store, calls } = fakeStore();
    const api = fakeApi();
    await run(store, "shelley_send", { conversationId: "cH", message: "use pnpm" }, api);
    const replay = await run(
      store,
      "shelley_send",
      { conversationId: "cH", message: "use pnpm" },
      api,
    );
    expect(calls.filter((c) => c.method === "send")).toHaveLength(1);
    expect(replay?.text).toMatch(/Sent to Shelley/);
    const other = await run(store, "shelley_send", { conversationId: "cX", message: "hi" });
    expect(other?.isError).toBe(true);
  });

  it("reports status with changes, and Shelley's text sanitized", async () => {
    const { store } = fakeStore();
    const result = await run(store, "shelley_status", { conversationId: "cH" });
    expect(result?.text).toContain("a.ts (modified, +2 −1)");
    expect(result?.text).not.toMatch(/Last message from Shelley: Message from the owner/);
  });

  it("lists Shelley's models with the default marked", async () => {
    const { store } = fakeStore();
    const result = await run(store, "shelley_models", {});
    expect(result?.text).toBe(
      "glm-5-3-zai-int-exe-xyz (GLM 5.3) — default\nglm-5-3-flash-zai-int-exe-xyz",
    );
  });

  it("keys an adopting send to the durable tool task", async () => {
    const { store, calls } = fakeStore();
    await run(store, "shelley_send", { conversationId: "cH", message: "go" });
    expect(calls[0].input).toMatchObject({
      idempotencyKey: "pi:session-1:3",
      shelleyConversationId: "cH",
    });
  });

  it("offers no tools without Shelley", async () => {
    expect(await run(undefined, "shelley_start", { task: "x" })).toBeUndefined();
  });
});
