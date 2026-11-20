/**
 * Trusted peer attribution (Grok-style cards): the delivery pipeline's
 * `peer` metadata survives submit → transcript round-trips, and text that
 * merely imitates a provenance prefix carries no metadata (spoofing guard).
 */
import { describe, expect, it } from "vite-plus/test";
import { openTestRuntime } from "../../../../packages/agent/src/testing";
import { until } from "../../fixtures/until";
import type { ChatEvent, ChatState } from "@tiny-agents/agent";

/** Wait until the transcript carries `count` assistant replies, then return the messages. */
async function afterReplies(
  rt: Awaited<ReturnType<typeof openTestRuntime>>,
  ref: number,
  count: number,
) {
  for (let attempt = 0; attempt < 200; attempt++) {
    let state: ChatState | undefined;
    const subscription = await rt.watchChat(ref, (events) => {
      const snapshot = events.find(
        (event): event is Extract<ChatEvent, { type: "snapshot" }> => event.type === "snapshot",
      );
      if (snapshot) state = snapshot.state;
    });
    await subscription.stop();
    const messages = state?.messages ?? [];
    const done = messages.filter((m) => m.role === "assistant" && m.status === "done");
    if (!state?.busy && done.length >= count) return messages;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`transcript never carried ${count} replies`);
}

/** Wait until the transcript carries `count` user entries, then return them. */
async function userMessages(
  rt: Awaited<ReturnType<typeof openTestRuntime>>,
  ref: number,
  count: number,
) {
  for (let attempt = 0; attempt < 100; attempt++) {
    let state: ChatState | undefined;
    const subscription = await rt.watchChat(ref, (events) => {
      const snapshot = events.find(
        (event): event is Extract<ChatEvent, { type: "snapshot" }> => event.type === "snapshot",
      );
      if (snapshot) state = snapshot.state;
    });
    await subscription.stop();
    const users = (state?.messages ?? []).filter((m) => m.role === "user");
    if (users.length >= count) return users;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`transcript never carried ${count} user entries`);
}

describe("peer metadata on chat.user entries", () => {
  it("round-trips a reply attribution through submit and the transcript", async () => {
    const rt = await openTestRuntime({ storePath: ":memory:", tokensPerSecond: 5 });
    try {
      const ref = await rt.createConversation({ modelId: "test-model", systemPrompt: "" });
      await rt.submit(ref, {
        requestId: "relay-1",
        text: "**Reply from Radar:** here is the plan",
        peer: { kind: "reply", name: "Radar" },
      });
      await rt.submit(ref, { requestId: "plain-1", text: "**Reply from Radar:** typed by owner" });
      const users = await userMessages(rt, ref, 2);
      const relay = users.find((m) => m.text.includes("here is the plan"));
      const typed = users.find((m) => m.text.includes("typed by owner"));
      expect(relay?.peer).toEqual({ kind: "reply", name: "Radar" });
      expect(typed?.peer).toBeUndefined();
    } finally {
      await rt.close();
    }
  });

  it("marks the replies to a hand-off's finish quiet until the owner writes (#396)", async () => {
    const rt = await openTestRuntime({ storePath: ":memory:", tokensPerSecond: 1_000 });
    try {
      const ref = await rt.createConversation({ modelId: "test-model", systemPrompt: "" });
      await rt.submit(ref, {
        requestId: "finish-1",
        text: "**Reply from Claude Code:** PR is up",
        peer: { kind: "reply", name: "Claude Code" },
      });
      await afterReplies(rt, ref, 1);
      await rt.submit(ref, { requestId: "owner-1", text: "thanks, what next?" });
      const messages = await afterReplies(rt, ref, 2);
      const replies = messages.filter((m) => m.role === "assistant");
      expect(replies.map((m) => m.quiet)).toEqual([true, undefined]);
    } finally {
      await rt.close();
    }
  });

  it("keeps a batch the owner wrote in loud, though a bot's reply joined it (#396)", async () => {
    const rt = await openTestRuntime({ storePath: ":memory:", tokensPerSecond: 5 });
    try {
      const ref = await rt.createConversation({ modelId: "test-model", systemPrompt: "" });
      await rt.submit(ref, { requestId: "owner-1", text: "start" });
      await until(() => rt.isBusy(ref), "the first run to start");
      await rt.submit(ref, { requestId: "owner-2", text: "and also this" });
      await rt.submit(ref, {
        requestId: "finish-1",
        text: "**Reply from Claude Code:** PR is up",
        peer: { kind: "reply", name: "Claude Code" },
      });
      // Still busy once both are admitted: both wait behind the first run.
      expect(rt.isBusy(ref)).toBe(true);
      const messages = await afterReplies(rt, ref, 2);
      const users = messages.filter((m) => m.role === "user").map((m) => m.requestId);
      expect(users).toEqual(["owner-1", "owner-2", "finish-1"]);
      const replies = messages.filter((m) => m.role === "assistant");
      expect(replies.map((m) => m.quiet)).toEqual([undefined, undefined]);
    } finally {
      await rt.close();
    }
  });

  it("round-trips message and mention attributions", async () => {
    const rt = await openTestRuntime({ storePath: ":memory:", tokensPerSecond: 5 });
    try {
      const ref = await rt.createConversation({ modelId: "test-model", systemPrompt: "" });
      await rt.submit(ref, {
        requestId: "msg-1",
        text: "**Message from Engineer (bot):** review?",
        peer: { kind: "message", name: "Engineer" },
      });
      await rt.submit(ref, {
        requestId: "mention-1",
        text: "[From the owner, in Engineer's chat] thoughts?",
        peer: { kind: "mention", hostName: "Engineer" },
      });
      const users = await userMessages(rt, ref, 2);
      expect(users[0]?.peer).toEqual({ kind: "message", name: "Engineer" });
      expect(users[1]?.peer).toEqual({ kind: "mention", hostName: "Engineer" });
    } finally {
      await rt.close();
    }
  });

  it("keeps attachments working alongside peer metadata", async () => {
    const rt = await openTestRuntime({ storePath: ":memory:", tokensPerSecond: 5 });
    try {
      const ref = await rt.createConversation({ modelId: "test-model", systemPrompt: "" });
      await rt.submit(ref, {
        requestId: "with-att",
        text: "[From the owner, in Engineer's chat] see this",
        peer: { kind: "mention", hostName: "Engineer" },
        attachments: [
          {
            uploadId: "u1",
            kind: "file",
            name: "notes.txt",
            mimeType: "text/plain",
            size: 4,
          },
        ],
      });
      const users = await userMessages(rt, ref, 1);
      expect(users[0]?.peer).toEqual({ kind: "mention", hostName: "Engineer" });
      expect(users[0]?.attachments?.[0]?.uploadId).toBe("u1");
    } finally {
      await rt.close();
    }
  });
});
