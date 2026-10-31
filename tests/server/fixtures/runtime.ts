/**
 * The app's runtime in server tests, two ways:
 *
 * - `openAppRuntime()`: the real `AgentRuntime` on the faux model, in
 *   memory, with the app capabilities a bot selects installed, registered as
 *   the app's runtime. Conversations, Turns, replies and busy windows are
 *   real; assert on behaviour, or `vi.spyOn` a method to assert on a call.
 *   The default for a suite that drives the app through its routes.
 *
 * - `createFakeRuntime()`: one typed fake with a default for every method the
 *   app calls, and a transcript scripted by request id (`fake.script`). For
 *   a suite that must inject a reply the faux model would not give (a model
 *   error, a refused tool, a vision model) or script what a conversation
 *   says. Type-checked against `AgentRuntime` method by method, so a fake
 *   cannot drift from the runtime it stands in for.
 */
import { vi, type MockInstance } from "vite-plus/test";
import {
  createMemoryCapability,
  createRoutinesToolkit,
  createSkillsCapability,
  createTasksToolkit,
  createTodayCapability,
  REPORT_ROUTINE_BLOCKED,
  type ActivityChange,
  type AgentRuntime,
  type ChatMessage,
  type ChatState,
  type FinishedReply,
  type ModelInfo,
  type WaitEvent,
} from "../../../packages/agent/src/index";
import { openTestRuntime, type TestRuntimeOptions } from "../../../packages/agent/src/testing";
import {
  botsCapability,
  setAgentRuntimeForTests,
} from "../../../apps/web/src/server/api/bots/bots.runtime";
import { memoryStore } from "../../../apps/web/src/server/api/bots/memories.store";
import { createRoutineStore } from "../../../apps/web/src/server/api/routines/routines.toolkit-store";
import { skillStore } from "../../../apps/web/src/server/api/skills/skills.store";
import { taskStore } from "../../../apps/web/src/server/api/tasks/task.store";

export { TEST_MODEL, TEST_MODEL_2 } from "../../../packages/agent/src/testing";

// ── The real runtime ────────────────────────────────────────────────────

type Current = { kind: "real"; runtime: AgentRuntime } | { kind: "fake"; fake: FakeRuntime };
let current: Current | undefined;

/** The app runtime a test opened or installed, if any (fixtures consult it). */
export function currentAppRuntime(): Current | undefined {
  return current;
}

/**
 * Open the real runtime in memory and make it the app's. Installs the
 * capabilities `BOT_TOOLKITS` selects whose stores are the app's own
 * (bots, tasks, routines, skills, memory, today); web, sandbox, browser and
 * attachments read the environment and are left to their own suites.
 */
export async function openAppRuntime(
  options: Partial<TestRuntimeOptions> = {},
): Promise<AgentRuntime> {
  const runtime = await openTestRuntime({ storePath: ":memory:", ...options });
  for (const capability of [
    botsCapability(runtime),
    createTasksToolkit(taskStore),
    createRoutinesToolkit(createRoutineStore()),
    createSkillsCapability(skillStore),
    createMemoryCapability(memoryStore),
    createTodayCapability(),
  ]) {
    runtime.installCapability(capability);
  }
  setAgentRuntimeForTests(runtime);
  current = { kind: "real", runtime };
  return runtime;
}

/** Close the runtime `openAppRuntime` opened (afterEach / afterAll). */
export async function closeAppRuntime(): Promise<void> {
  const open = current;
  current = undefined;
  if (open?.kind === "real") await open.runtime.close();
}

// ── The typed fake ──────────────────────────────────────────────────────

/** Every runtime method the app (or a test) calls on it. */
const FAKE_METHODS = [
  "createConversation",
  "configure",
  "submit",
  "abort",
  "withdraw",
  "readChat",
  "readChatPage",
  "watchChat",
  "isBusy",
  "busyConversations",
  "onActivity",
  "onWait",
  "lastMessage",
  "finishedReplies",
  "listModels",
  "hasModel",
  "listCapabilities",
  "installCapability",
  "uninstallCapability",
  "pendingApprovals",
  "decideApproval",
  "pendingQuestions",
  "answerQuestions",
  "dismissQuestions",
  "attachmentIds",
  "settleCredentialRequest",
  "close",
] as const;

type FakeMethod = (typeof FAKE_METHODS)[number];
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a method's parameter list
type Procedure = (...args: any[]) => any;
type MockOf<F> = F extends Procedure ? ReturnType<typeof vi.fn<F>> : never;

export type FakeRuntime = { [K in FakeMethod]: MockOf<AgentRuntime[K]> } & {
  provider: string;
  /** The transcript the fake shows, scripted by request id. */
  script: TranscriptScript;
  /** Fire an activity change at every `onActivity` listener. */
  emitActivity(
    change: Pick<ActivityChange, "conversation" | "busy"> & Partial<ActivityChange>,
  ): void;
  /** Fire a wait event at every `onWait` listener. */
  emitWait(event: WaitEvent): void;
  /** Listeners registered through `onActivity` (how many are live). */
  readonly activityListeners: ReadonlySet<(change: ActivityChange) => void>;
};

/** The catalog the fake lists: a text model and one that sees images. */
export const FAKE_MODELS: ModelInfo[] = [
  {
    id: "known-model",
    name: "Known Model",
    family: "other",
    reasoning: false,
    contextWindow: 8_192,
    vision: false,
  },
  {
    id: "vision-model",
    name: "Vision Model",
    family: "other",
    reasoning: false,
    contextWindow: 8_192,
    vision: true,
  },
];

/**
 * The fake's transcripts. A submit becomes a user message in its
 * conversation; `answer(requestId, reply)` ends that Turn with an assistant
 * message carrying the reply's text, error, refused tools and blocked
 * reason, the shapes `finishedReplyTo` reads. `say` scripts a conversation
 * outright (owner, bot, owner, bot…).
 */
export interface TranscriptScript {
  submitted(conversation: number): string[];
  answer(requestId: string, reply: Omit<FinishedReply, "createdAt">, conversation?: number): void;
  say(conversation: number, ...turns: string[]): void;
  transcript(conversation: number): ChatState;
  reset(): void;
}

type Script = TranscriptScript & { record(conversation: number, requestId: string): void };

function createScript(): Script {
  const submitted = new Map<number, string[]>();
  const answers = new Map<
    string,
    { conversation: number | undefined; reply: Omit<FinishedReply, "createdAt"> }
  >();
  const scripted = new Map<number, ChatMessage[]>();

  const replyMessage = (
    id: string,
    reply: Omit<FinishedReply, "createdAt">,
    createdAt: number,
  ): ChatMessage => ({
    id,
    role: "assistant",
    text: reply.text,
    status: reply.error !== undefined ? "error" : "done",
    ...(reply.error !== undefined ? { error: reply.error } : {}),
    toolCalls: [
      ...(reply.refused ?? []).map((name) => ({
        id: "",
        name,
        args: {},
        status: "error" as const,
        approval: "refused" as const,
      })),
      ...(reply.blocked !== undefined
        ? [
            {
              id: "",
              name: REPORT_ROUTINE_BLOCKED,
              args: { reason: reply.blocked },
              status: "done" as const,
            },
          ]
        : []),
    ],
    createdAt,
  });

  return {
    record(conversation, requestId) {
      const list = submitted.get(conversation) ?? [];
      if (!list.includes(requestId)) submitted.set(conversation, [...list, requestId]);
    },
    submitted: (conversation) => [...(submitted.get(conversation) ?? [])],
    answer(requestId, reply, conversation) {
      answers.set(requestId, { conversation, reply });
    },
    say(conversation, ...turns) {
      scripted.set(
        conversation,
        turns.map((text, i) => ({
          id: `e${i + 1}`,
          role: i % 2 === 0 ? "user" : "assistant",
          text,
          status: "done",
          createdAt: Date.now() - 60_000 + i,
        })),
      );
    },
    transcript(conversation) {
      const messages: ChatMessage[] = [...(scripted.get(conversation) ?? [])];
      const own = submitted.get(conversation) ?? [];
      const ids = [
        ...own,
        ...[...answers.entries()]
          .filter(([id, a]) => a.conversation === conversation && !own.includes(id))
          .map(([id]) => id),
      ];
      let at = messages.length + 1;
      for (const requestId of ids) {
        messages.push({
          id: `u${at}`,
          role: "user",
          text: "",
          requestId,
          status: "done",
          createdAt: at++,
        });
        const answer = answers.get(requestId);
        if (
          !answer ||
          (answer.conversation !== undefined && answer.conversation !== conversation)
        ) {
          continue;
        }
        messages.push(replyMessage(`a${at}`, answer.reply, at++));
      }
      return { messages, busy: false, queued: [] };
    },
    reset() {
      submitted.clear();
      answers.clear();
      scripted.clear();
    },
  };
}

/**
 * A fake with every method defaulted: conversations number from 100,
 * submits land in the script, nothing is busy or waiting, the catalog is
 * `FAKE_MODELS` and every model id is known. Override per test through the
 * mocks (`fake.hasModel.mockReturnValue(false)`).
 */
export function createFakeRuntime(overrides: Partial<FakeRuntime> = {}): FakeRuntime {
  const script = createScript();
  const transcript = (conversation: number): ChatState => script.transcript(conversation);
  let nextConversation = 100;
  const activity = new Set<(change: ActivityChange) => void>();
  const waits = new Set<(event: WaitEvent) => void>();

  const fake: FakeRuntime = {
    provider: "fake",
    script,
    activityListeners: activity,
    emitActivity(change) {
      const full: ActivityChange = { approvals: 0, questions: 0, ...change };
      for (const listener of activity) listener(full);
    },
    emitWait(event) {
      for (const listener of waits) listener(event);
    },
    createConversation: vi.fn<AgentRuntime["createConversation"]>(async () => nextConversation++),
    configure: vi.fn<AgentRuntime["configure"]>(async () => undefined),
    submit: vi.fn<AgentRuntime["submit"]>(async (ref, input) => {
      script.record(Number(ref), input.requestId);
    }),
    abort: vi.fn<AgentRuntime["abort"]>(async () => undefined),
    withdraw: vi.fn<AgentRuntime["withdraw"]>(async () => "withdrawn"),
    readChat: vi.fn<AgentRuntime["readChat"]>(async (ref) => transcript(Number(ref))),
    readChatPage: vi.fn<AgentRuntime["readChatPage"]>(async () => undefined),
    watchChat: vi.fn<AgentRuntime["watchChat"]>(async (ref, listener) => {
      const initial = transcript(Number(ref));
      await listener([{ type: "snapshot", state: initial }]);
      return { initial, stop: async () => undefined };
    }),
    isBusy: vi.fn<AgentRuntime["isBusy"]>(() => false),
    busyConversations: vi.fn<AgentRuntime["busyConversations"]>(() => []),
    onActivity: vi.fn<AgentRuntime["onActivity"]>((listener) => {
      activity.add(listener);
      return () => activity.delete(listener);
    }),
    onWait: vi.fn<AgentRuntime["onWait"]>((listener) => {
      waits.add(listener);
      return () => waits.delete(listener);
    }),
    lastMessage: vi.fn<AgentRuntime["lastMessage"]>(async (ref) => {
      const last = transcript(Number(ref)).messages.findLast((m) => m.role !== "marker");
      return last && last.role !== "marker"
        ? { role: last.role, text: last.text, createdAt: last.createdAt }
        : undefined;
    }),
    finishedReplies: vi.fn<AgentRuntime["finishedReplies"]>(async () => []),
    listModels: vi.fn<AgentRuntime["listModels"]>(() => FAKE_MODELS),
    hasModel: vi.fn<AgentRuntime["hasModel"]>(() => true),
    listCapabilities: vi.fn<AgentRuntime["listCapabilities"]>(() => []),
    installCapability: vi.fn<AgentRuntime["installCapability"]>(() => undefined),
    uninstallCapability: vi.fn<AgentRuntime["uninstallCapability"]>(() => undefined),
    pendingApprovals: vi.fn<AgentRuntime["pendingApprovals"]>(() => 0),
    decideApproval: vi.fn<AgentRuntime["decideApproval"]>(async () => undefined),
    pendingQuestions: vi.fn<AgentRuntime["pendingQuestions"]>(() => 0),
    answerQuestions: vi.fn<AgentRuntime["answerQuestions"]>(async () => undefined),
    dismissQuestions: vi.fn<AgentRuntime["dismissQuestions"]>(async () => undefined),
    attachmentIds: vi.fn<AgentRuntime["attachmentIds"]>(async () => []),
    settleCredentialRequest: vi.fn<AgentRuntime["settleCredentialRequest"]>(async () => undefined),
    close: vi.fn<AgentRuntime["close"]>(async () => undefined),
    ...overrides,
  };
  return fake;
}

/** Every method of the real runtime wrapped in a spy: assert on calls, or override one for a test. */
export type SpiedRuntime = {
  [K in FakeMethod]: AgentRuntime[K] extends Procedure ? MockInstance<AgentRuntime[K]> : never;
};

/**
 * Spy on every runtime method the app calls. The real behaviour runs
 * underneath; `mockResolvedValueOnce` on a spy injects what the faux model
 * cannot (a refused approval, a page before a cursor).
 */
export function spyOnRuntime(runtime: AgentRuntime): SpiedRuntime {
  const spied = {} as Record<FakeMethod, unknown>;
  for (const method of FAKE_METHODS) spied[method] = vi.spyOn(runtime, method);
  return spied as SpiedRuntime;
}

/** Make a fake the app's runtime (`getAgentRuntime()`), typed as the runtime it stands in for. */
export function installFakeRuntime(fake: FakeRuntime = createFakeRuntime()): FakeRuntime {
  setAgentRuntimeForTests(fake as unknown as AgentRuntime);
  current = { kind: "fake", fake };
  return fake;
}
