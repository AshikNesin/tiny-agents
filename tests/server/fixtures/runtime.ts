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

export { TEST_MODEL } from "../../../packages/agent/src/testing";

type Current = { kind: "real"; runtime: AgentRuntime } | { kind: "fake"; fake: FakeRuntime };
let current: Current | undefined;

export function currentAppRuntime(): Current | undefined {
  return current;
}

export async function openAppRuntime(
  options: Partial<TestRuntimeOptions> = {},
): Promise<AgentRuntime> {
  const runtime = await openTestRuntime({ storePath: ":memory:", ...options });
  for (const capability of [
    botsCapability(runtime),
    ...Object.values(appStoreCapabilities(appEnv({}))),
  ]) {
    runtime.installCapability(capability);
  }
  useTestRuntime(runtime);
  current = { kind: "real", runtime };
  return runtime;
}

export async function closeAppRuntime(): Promise<void> {
  const open = current;
  current = undefined;
  if (open?.kind === "real") await open.runtime.close();
}

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

export type FakeCatalog = { [K in keyof ModelCatalog]: MockOf<ModelCatalog[K]> };

export type FakeRuntime = { [K in FakeMethod]: MockOf<AgentRuntime[K]> } & {
  catalog: FakeCatalog;
  script: TranscriptScript;
  emitActivity(
    change: Pick<ActivityChange, "conversation" | "busy"> & Partial<ActivityChange>,
  ): void;
  emitWait(event: WaitEvent): void;
  readonly activityListeners: ReadonlySet<(change: ActivityChange) => void>;
};

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

export type SpiedRuntime = {
  [K in FakeMethod]: AgentRuntime[K] extends Procedure ? MockInstance<AgentRuntime[K]> : never;
};

export function spyOnRuntime(runtime: AgentRuntime): SpiedRuntime {
  const spied = {} as Record<FakeMethod, unknown>;
  for (const method of FAKE_METHODS) spied[method] = vi.spyOn(runtime, method);
  return spied as SpiedRuntime;
}

export function installFakeRuntime(fake: FakeRuntime = createFakeRuntime()): FakeRuntime {
  useTestRuntime(fake as unknown as AgentRuntime);
  current = { kind: "fake", fake };
  return fake;
}

export function useTestRuntime(runtime: AgentRuntime | undefined): void {
  installAppForTests({ runtime, runtimeReady: true });
}
