import { describe, expect, it } from "vite-plus/test";
import {
  createArtifactsToolkit,
  type ArtifactRef,
  type ArtifactSnapshot,
  type ArtifactStore,
} from "../../../../packages/agent/src/toolkits/artifacts";
import { applyEdits } from "../../../../packages/agent/src/toolkits/artifacts-edit";
import {
  openTestRuntime,
  TEST_MODEL,
  fauxToolCall,
  fauxText,
  fauxAssistantMessage,
} from "../../../../packages/agent/src/testing";
import type { ChatEvent, ChatState, ChatToolCall } from "../../../../packages/agent/src/types";
import { until } from "../../fixtures/until";

function memoryStore(): ArtifactStore & { versions: Map<string, string[]> } {
  const refs = new Map<string, ArtifactRef>();
  const versions = new Map<string, string[]>();
  const snapshot = (slug: string, seq: number): ArtifactSnapshot | undefined => {
    const ref = refs.get(slug);
    const content = versions.get(slug)?.[seq - 1];
    return ref && content !== undefined ? { ...ref, seq, content } : undefined;
  };
  return {
    versions,
    async create(_conversation, input) {
      const ref = {
        id: `art-${refs.size + 1}`,
        slug: input.slug,
        title: input.title,
        kind: input.kind,
        language: input.language ?? null,
        seq: 1,
      };
      refs.set(input.slug, ref);
      versions.set(input.slug, [input.content]);
      return ref;
    },
    async commit(_conversation, input) {
      const ref = refs.get(input.slug);
      if (!ref) return undefined;
      if (ref.seq !== input.baseSeq) return { stale: ref };
      const next = { ...ref, seq: ref.seq + 1, title: input.title ?? ref.title };
      refs.set(input.slug, next);
      versions.get(input.slug)!.push(input.content);
      return { artifact: next };
    },
    async read(_conversation, slug, seq) {
      return snapshot(slug, seq ?? refs.get(slug)?.seq ?? 0);
    },
    async list() {
      return [...refs.values()];
    },
  };
}

function reduce(events: ChatEvent[]): ChatState | undefined {
  let state: ChatState | undefined;
  for (const event of events) {
    if (event.type === "snapshot") state = structuredClone(event.state);
    else if (state && event.type === "upsert") {
      const i = state.messages.findIndex((m) => m.id === event.message.id);
      if (i >= 0) state.messages[i] = event.message;
      else state.messages.push(event.message);
    } else if (state && event.type === "busy") state.busy = event.busy;
  }
  return state;
}

async function chat(store: ArtifactStore, replies: ReturnType<typeof fauxAssistantMessage>[]) {
  const queue = replies.map((message) =>
    message.content.some((b) => b.type === "toolCall")
      ? { ...message, stopReason: "toolUse" as const }
      : message,
  );
  const events: ChatEvent[] = [];
  const runtime = await openTestRuntime({
    storePath: ":memory:",
    extensions: [createArtifactsToolkit(store).extension],
    respondWith: () => (queue.length > 1 ? queue.shift()! : queue[0]!),
  });
  const ref = await runtime.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });
  const sub = await runtime.watchChat(ref, (batch) => {
    events.push(...batch);
  });
  await runtime.submit(ref, { requestId: "r1", text: "write it up" });
  const state = await until(() => {
    const latest = reduce(events);
    const replied = latest?.messages.some((m) => m.role === "assistant" && m.text);
    return latest && !latest.busy && replied && latest;
  }, "an assistant reply");
  await sub.stop();
  await runtime.close();
  const calls: ChatToolCall[] = state.messages.flatMap((m) => m.toolCalls ?? []);
  return { calls };
}

const PLAN = "# Plan\n\n- pack\n- fly\n- pack\n";

describe("artifact tools", () => {
  it("creates and edits an artifact, and the chat's tool calls point at each version", async () => {
    const store = memoryStore();
    const { calls } = await chat(store, [
      fauxAssistantMessage([
        fauxToolCall("create_artifact", {
          slug: "trip-plan",
          title: "Trip plan",
          kind: "markdown",
          content: PLAN,
        }),
      ]),
      fauxAssistantMessage([
        fauxToolCall("edit_artifact", {
          slug: "trip-plan",
          base_version: 1,
          edits: [{ old_string: "- fly", new_string: "- take the train" }],
        }),
      ]),
      fauxAssistantMessage([fauxText("Done.")]),
    ]);

    expect(store.versions.get("trip-plan")).toEqual([
      PLAN,
      "# Plan\n\n- pack\n- take the train\n- pack\n",
    ]);
    expect(calls.map((call) => [call.name, call.status, call.artifact])).toEqual([
      [
        "create_artifact",
        "done",
        { id: "art-1", slug: "trip-plan", title: "Trip plan", kind: "markdown", seq: 1 },
      ],
      [
        "edit_artifact",
        "done",
        { id: "art-1", slug: "trip-plan", title: "Trip plan", kind: "markdown", seq: 2 },
      ],
    ]);
  }, 15_000);

  it("refuses an edit whose old_string matches twice, and one built on an old version", async () => {
    const store = memoryStore();
    await store.create("c", {
      idempotencyKey: "k",
      slug: "trip-plan",
      title: "Trip plan",
      kind: "markdown",
      content: PLAN,
    });
    await store.commit("c", {
      idempotencyKey: "k2",
      slug: "trip-plan",
      baseSeq: 1,
      op: "rewrite",
      content: PLAN,
    });
    const { calls } = await chat(store, [
      fauxAssistantMessage([
        fauxToolCall("edit_artifact", {
          slug: "trip-plan",
          base_version: 2,
          edits: [{ old_string: "- pack", new_string: "- pack light" }],
        }),
      ]),
      fauxAssistantMessage([
        fauxToolCall("edit_artifact", {
          slug: "trip-plan",
          base_version: 1,
          edits: [{ old_string: "- fly", new_string: "- drive" }],
        }),
      ]),
      fauxAssistantMessage([fauxText("Could not edit.")]),
    ]);

    expect(calls.map((call) => call.status)).toEqual(["error", "error"]);
    expect(calls[0]!.output).toContain("old_string matches 2 places");
    expect(calls[1]!.output).toContain('Artifact "trip-plan" is at version 2, not 1');
    expect(calls.some((call) => call.artifact)).toBe(false);
    expect(store.versions.get("trip-plan")).toEqual([PLAN, PLAN]);
  }, 15_000);
});

describe("applyEdits", () => {
  it("applies edits in order and replaces every match only with replace_all", () => {
    expect(
      applyEdits(PLAN, [
        { old_string: "- pack", new_string: "- bag", replace_all: true },
        { old_string: "- fly", new_string: "- $& sail" },
      ]),
    ).toEqual({ content: "# Plan\n\n- bag\n- $& sail\n- bag\n" });
  });

  it("names the failing edit and changes nothing", () => {
    expect(
      applyEdits(PLAN, [
        { old_string: "- fly", new_string: "- drive" },
        { old_string: "- swim", new_string: "- dive" },
      ]),
    ).toEqual({
      error: "Edit 2: old_string was not found. Read the artifact and copy it exactly.",
    });
  });
});
