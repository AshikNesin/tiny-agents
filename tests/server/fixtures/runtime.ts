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
 *   cannot drift from the runtime it stands in for. Its Model catalog is
 *   `fakeCatalog()`: `FAKE_MODELS`, every id known.
 */
import { vi, type MockInstance } from "vite-plus/test";
import {
  REPORT_ROUTINE_BLOCKED,
  type ActivityChange,
  type AgentRuntime,
  type ChatMessage,
  type ChatState,
  type FinishedReply,
  type WaitEvent,
} from "../../../packages/agent/src/index";
import type { CatalogModel, ModelCatalog } from "../../../packages/models/src/index";
import { openTestRuntime, type TestRuntimeOptions } from "../../../packages/agent/src/testing";
import {
  appStoreCapabilities,
  botsCapability,
} from "../../../apps/web/src/server/api/bots/bots.runtime";
import { appEnv } from "../../../apps/web/src/server/env";
import { installAppForTests } from "../../../apps/web/src/server/app-root";
import { currentRuntimeSlot, setCurrentRuntimeSlot } from "./runtime-slot";

export { TEST_MODEL } from "../../../packages/agent/src/testing";

// ── The real runtime ────────────────────────────────────────────────────

type Current = { kind: "real"; runtime: AgentRuntime } | { kind: "fake"; fake: FakeRuntime };

/** The app runtime a test opened or installed, if any (fixtures consult it). */
export function currentAppRuntime(): Current | undefined {
  return currentRuntimeSlot() as Current | undefined;
}

/**
 * Open the real runtime in memory and make it the app's. Installs the
 * built-in toolkits whose stores are the app's own, from the same source as
 * the server (`botsCapability` and `appStoreCapabilities`: bots, tasks,
 * routines, skills, memory, today); web, sandbox, browser and attachments
 * read the environment and are left to their own suites.
 */
export async function openAppRuntime(
  options: Partial<TestRuntimeOptions> = {},
): Promise<AgentRuntime> {
  const runtime = await openTestRuntime({ storePath: ":memory:", ...options });
  for (const capability of [
    botsCapability(runtime),
    // No TZ: the host's timezone, as before the server's env applied.
    ...Object.values(appStoreCapabilities(appEnv({}))),
  ]) {
    runtime.installCapability(capability);
  }
  useTestRuntime(runtime);
  setCurrentRuntimeSlot({ kind: "real", runtime });
  return runtime;
}

/** Close the runtime `openAppRuntime` opened (afterEach / afterAll). */
export async function closeAppRuntime(): Promise<void> {
  const open = currentAppRuntime();
  setCurrentRuntimeSlot(undefined);
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
  "usedTokens",
  "busyConversations",
  "onActivity",
  "onWait",
  "lastMessage",
  "finishedReplies",
  "listCapabilities",
  "installCapability",
  "uninstallCapability",
  "pendingApprovals",
  "decideApproval",
  "yolo",
  "setYolo",
  "pendingQuestions",
  "answerQuestions",
  "dismissQuestions",
  "attachmentIds",
  "settleCredentialRequest",
  "applyModelConfig",
  "close",
] as const;

type FakeMethod = (typeof FAKE_METHODS)[number];
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a method's parameter list
type Procedure = (...args: any[]) => any;
type MockOf<F> = F extends Procedure ? ReturnType<typeof vi.fn<F>> : never;

/** A Model catalog fake: every method a mock, typed against `ModelCatalog`. */
export type FakeCatalog = { [K in keyof ModelCatalog]: MockOf<ModelCatalog[K]> };

export type FakeRuntime = { [K in FakeMethod]: MockOf<AgentRuntime[K]> } & {
  catalog: FakeCatalog;
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
/** A fake catalog entry: a faux chat model on pi, available. */
export function fakeModel(id: string, overrides: Partial<CatalogModel> = {}): CatalogModel {
  return {
    id,
    name: id,
    providerId: "fake",
    providerName: "Fake",
    providerKind: "faux",
    upstreamId: id,
    type: "chat",
    engine: "pi",
    contextWindow: 8_192,
    maxOutputTokens: 4_096,
    vision: false,
    reasoning: false,
    enabled: true,
    available: true,
    ...overrides,
  };
}

const FAKE_MODELS: CatalogModel[] = [
  fakeModel("known-model", { name: "Known Model" }),
  fakeModel("vision-model", { name: "Vision Model", vision: true }),
];

/**
 * The fake's transcripts. A submit becomes a user message in its
 * conversation; `answer(requestId, reply)` ends that Turn with an assistant
 * message carrying the reply's text, error, refused tools, blocked reason
 * and run limit, the shapes `finishedReplyTo` reads. `say` scripts a conversation
 * outright (owner, bot, owner, bot…).
 */
interface TranscriptScript {
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
      ...(reply.stoppedBy !== undefined
        ? [
            {
              id: "",
              name: "web_fetch",
              args: {},
              status: "error" as const,
              limit: reply.stoppedBy,
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
 * A catalog listing `models` (`FAKE_MODELS` by default) that knows every id
 * (`get` answers a listed model, else a text model of that id), routes
 * nothing to a registry model and can answer. Override per test through the
 * mocks (`catalog.get.mockReturnValue(undefined)`).
 */
export function fakeCatalog(models: CatalogModel[] = FAKE_MODELS): FakeCatalog {
  const catalog: FakeCatalog = {
    list: vi.fn<ModelCatalog["list"]>(() => models),
    get: vi.fn<ModelCatalog["get"]>(
      (id) => catalog.list().find((m) => m.id === id) ?? fakeModel(id),
    ),
    route: vi.fn<ModelCatalog["route"]>(() => undefined),
    piModel: vi.fn<ModelCatalog["piModel"]>(() => undefined),
    classifierModel: vi.fn<ModelCatalog["classifierModel"]>(() => undefined),
    forRole: vi.fn<ModelCatalog["forRole"]>(() => models[0]),
    roleIsSet: vi.fn<ModelCatalog["roleIsSet"]>(() => false),
    providers: vi.fn<ModelCatalog["providers"]>(() => []),
    claudePlan: vi.fn<ModelCatalog["claudePlan"]>(() => undefined),
    canAnswer: vi.fn<ModelCatalog["canAnswer"]>(() => true),
  };
  return catalog;
}

/**
 * A fake with every method defaulted: conversations number from 100,
 * submits land in the script, nothing is busy or waiting, the catalog is
 * `fakeCatalog()`. Override per test through the mocks
 * (`fake.catalog.get.mockReturnValue(undefined)`).
 */
export function createFakeRuntime(overrides: Partial<FakeRuntime> = {}): FakeRuntime {
  const script = createScript();
  const transcript = (conversation: number): ChatState => script.transcript(conversation);
  let nextConversation = 100;
  const activity = new Set<(change: ActivityChange) => void>();
  const waits = new Set<(event: WaitEvent) => void>();

  const fake: FakeRuntime = {
    catalog: fakeCatalog(),
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
    usedTokens: vi.fn<AgentRuntime["usedTokens"]>(async () => 0),
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
    listCapabilities: vi.fn<AgentRuntime["listCapabilities"]>(() => []),
    installCapability: vi.fn<AgentRuntime["installCapability"]>(() => undefined),
    uninstallCapability: vi.fn<AgentRuntime["uninstallCapability"]>(() => undefined),
    pendingApprovals: vi.fn<AgentRuntime["pendingApprovals"]>(() => 0),
    decideApproval: vi.fn<AgentRuntime["decideApproval"]>(async () => undefined),
    yolo: vi.fn<AgentRuntime["yolo"]>(async () => false),
    setYolo: vi.fn<AgentRuntime["setYolo"]>(async (_ref, on) => ({ on, approved: [] })),
    pendingQuestions: vi.fn<AgentRuntime["pendingQuestions"]>(() => 0),
    answerQuestions: vi.fn<AgentRuntime["answerQuestions"]>(async () => undefined),
    dismissQuestions: vi.fn<AgentRuntime["dismissQuestions"]>(async () => undefined),
    attachmentIds: vi.fn<AgentRuntime["attachmentIds"]>(async () => []),
    settleCredentialRequest: vi.fn<AgentRuntime["settleCredentialRequest"]>(async () => undefined),
    applyModelConfig: vi.fn<AgentRuntime["applyModelConfig"]>(() => undefined),
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
  useTestRuntime(fake as unknown as AgentRuntime);
  setCurrentRuntimeSlot({ kind: "fake", fake });
  return fake;
}

/**
 * Make `runtime` the app's (the App root's), as boot would, and mark it
 * ready. Pass undefined to leave none installed (still marked ready).
 */
export function useTestRuntime(runtime: AgentRuntime | undefined): void {
  installAppForTests({ runtime, runtimeReady: true });
}
