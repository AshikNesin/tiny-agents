/**
 * Characterization of behavior-register row C16: settling re-runs when wait
 * counts change after the idle edge, bumping the memory-capture counter
 * twice (and rewriting the list). Narrow: a plain turn emits one idle event.
 * Preserve: this pins today's behavior, quirk included; change it only with
 * a signed-off register row.
 *
 * The sequence that reaches it: a Claude plan turn stopped while a tool call
 * waits for approval. The engine goes idle at once, with the approval still
 * counted; the gate drops the approval just after, which is a second idle
 * activity change, and the settled pipeline settles the conversation again.
 */
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type { AgentRuntime } from "../../../packages/agent/src/runtime";
import type { ActivityChange, ConversationRef } from "../../../packages/agent/src/types";
import { startSettledPipeline } from "../../../apps/web/src/server/api/bots/bots.settled";
import type { SideCallRequest } from "../../../apps/web/src/server/api/bots/side-call";
import type { Notifier } from "../../../apps/web/src/server/api/notifications/notifications.wiring";
import {
  awaitingApproval,
  mailCapability,
  openEngine,
  watch,
  type WatchedChat,
} from "../app/agent/engine-harness";
import { resetAppTables, seedBot, until } from "../fixtures";

/** Run notifications go nowhere here. */
const silentNotifier = {
  notify: () => undefined,
  cancel: () => undefined,
  getSettings: async () => ({ longRunMinutes: 1_000, reminderMinutes: 0 }),
  defineEvents: () => undefined,
} as unknown as Notifier;

const cleanup: (() => Promise<void> | void)[] = [];
beforeEach(resetAppTables);
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
  await resetAppTables();
});

async function setup() {
  const engine = await openEngine("claude-code", { capabilities: [mailCapability([])] });
  const { runtime } = engine;
  cleanup.push(() => runtime.close());
  const ref = await runtime.createConversation({
    modelId: engine.modelId,
    systemPrompt: "",
    capabilities: { enabled: ["mail"], permissions: {} },
  });
  // The bot's own chat, memory on: memory capture counts its settled turns.
  await seedBot({ name: "Mailer", conversationId: String(ref) });
  const captures: SideCallRequest[] = [];
  const stop = startSettledPipeline(runtime, {
    notifier: silentNotifier,
    memoryCapture: {
      sideCaller: {
        complete: async (request) => {
          captures.push(request);
          return "[]";
        },
      },
    },
  });
  cleanup.push(stop);
  const activity: ActivityChange[] = [];
  const off = runtime.onActivity((change) => {
    if (change.conversation === ref) activity.push(change);
  });
  cleanup.push(() => void off());
  const chat = await watch(runtime, ref);
  cleanup.push(() => chat.stop());
  return { ...engine, ref, captures, activity, chat };
}

/** One turn whose send_email waits for approval, stopped before the owner answers. */
async function stoppedWhileWaiting(
  runtime: AgentRuntime,
  send: (ref: ConversationRef, input: { requestId: string; text: string }) => Promise<void>,
  chat: WatchedChat,
  ref: ConversationRef,
  n: number,
) {
  await send(ref, {
    requestId: `c16-${n}`,
    text: `Please send_email ana${n}@x.dev about the quarterly numbers`,
  });
  await until(async () => {
    const call = await awaitingApproval(chat, "send_email");
    return call.args.to === `ana${n}@x.dev`;
  }, `turn ${n}'s approval card`);
  await runtime.abort(ref);
  await until(
    () => runtime.pendingApprovals(ref) === 0 && !runtime.isBusy(ref),
    "the stopped turn to drop its approval",
  );
}

const idleCount = (activity: ActivityChange[]) => activity.filter((change) => !change.busy).length;

describe("C16: a second idle edge after a stopped Claude plan turn", () => {
  it("narrow: a plain turn on the same engine emits one idle change", async () => {
    const { runtime, send, ref, activity } = await setup();
    await send(ref, { requestId: "c16-plain", text: "hello there" });
    await until(async () => {
      const state = await runtime.readChat(ref);
      return !state.busy && state.messages.at(-1)?.text === "Echo: hello there";
    }, "the plain reply");
    expect(idleCount(activity)).toBe(1);
  }, 15_000);

  it("emits two idle changes per stopped turn, so three turns reach the 6-turn capture limit", async () => {
    const { runtime, send, chat, ref, activity, captures } = await setup();

    await stoppedWhileWaiting(runtime, send, chat, ref, 1);
    // The golden: busy, the card, idle with the card still counted, idle again.
    expect(
      activity.map(({ busy, approvals, questions }) => ({ busy, approvals, questions })),
    ).toEqual([
      { busy: true, approvals: 0, questions: 0 },
      { busy: true, approvals: 1, questions: 0 },
      { busy: false, approvals: 1, questions: 0 },
      { busy: false, approvals: 0, questions: 0 },
    ]);

    await stoppedWhileWaiting(runtime, send, chat, ref, 2);
    expect(idleCount(activity)).toBe(4);
    // Four settles so far: under the limit, and the 2-minute quiet window is far off.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(captures).toHaveLength(0);

    // The third stopped turn is the sixth settle: capture runs at once.
    await stoppedWhileWaiting(runtime, send, chat, ref, 3);
    expect(idleCount(activity)).toBe(6);
    await until(() => captures.length > 0, "the turn-limit capture");
    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatchObject({ role: "memory_capture", label: "Memory capture" });
    expect(captures[0]!.system).toContain("Owner: Please send_email ana3@x.dev");
  }, 30_000);
});
