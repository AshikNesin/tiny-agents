import {
  AgentRuntime,
  createAttachmentsToolkit,
  createBotBuilderCapability,
  createBotsToolkit,
  createBrowserToolkit,
  createClassifier,
  createCodingToolkit,
  createComputerToolkit,
  createMemoryCapability,
  createReviewer,
  createRoutinesToolkit,
  createSelfImproveCapability,
  createSandboxToolkit,
  createSkillsCapability,
  createCodeToolkit,
  createTasksToolkit,
  createTodayCapability,
  createTranscriber,
  createVaultToolkit,
  createVisionToolkit,
  createWebToolkit,
  secretRedactor,
  type BotMessagingStore,
  type Capability,
  type Reviewer,
} from "@tiny-agents/agent";
import type { ModelConfig } from "@tiny-agents/models";
import type { Context as PiContext, ToolCall } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
  TEST_MODEL,
} from "@tiny-agents/agent/testing";
import { logger, setScrubber } from "@groot/core/logger";
import { recordLlmCall } from "../traces/traces.calls";
import { taskStore } from "../tasks/task.store";
import { codeStore } from "../code/code.bots";
import { skillStore } from "../skills/skills.store";
import { memoryStore } from "./memories.store";
import { createBotMessagingStore } from "./bots.messaging";
import { createAttachmentStore, createVisionStore } from "../uploads/uploads.store";
import { createInstructionsStore } from "./self-improve.store";
import { createBotCreationStore } from "./bot-builder.store";
import { ownerUserId } from "../people/people.service";
import { createRoutineStore } from "../routines/routines.toolkit-store";
import { browserTargetForConversation } from "./browser.targets";
import { createVaultBroker } from "../vault/vault.broker";
import { getBrowserSessions } from "./browser.sessions";
import {
  computerProfileForConversation,
  computerSetupHint,
  getComputerSessions,
} from "./computer.sessions";
import { sandboxConnection, unquoteEnv as unquote } from "./sandbox-host";
import { sharedClaudeWorkerLocator } from "./claude-worker";
import { missingToolkits } from "./bot-toolkits";
import { appEnv, type AppEnv } from "../../env";
import {
  bindModelRuntime,
  loadModelConfig,
  seedFauxModels,
  vaultCredentials,
} from "../models/models.config";
import { app } from "../../app-root";

type RuntimeOptions = Parameters<typeof AgentRuntime.open>[0];
type RuntimeEnv = Readonly<Record<string, string | undefined>>;

export function appStoreCapabilities(env: AppEnv = appEnv()) {
  return {
    tasks: createTasksToolkit(taskStore),
    routines: createRoutinesToolkit(createRoutineStore()),
    skills: createSkillsCapability(skillStore),
    memory: createMemoryCapability(memoryStore),
    today: createTodayCapability({ timeZone: unquote(env.TZ) }),
  } satisfies Record<string, Capability>;
}

function claudePlanOn(config: ModelConfig): boolean {
  return config.providers.some((p) => p.kind === "claude-plan" && p.enabled);
}

function builtinCapabilities(env: AppEnv, config: ModelConfig): Capability[] {
  setScrubber((text) => secretRedactor.scrub(text));
  const vault = createVaultBroker(getAgentRuntime);
  const own = appStoreCapabilities(env);
  return [
    own.skills,
    own.memory,
    createSelfImproveCapability(createInstructionsStore()),
    createBotBuilderCapability(createBotCreationStore()),
    own.tasks,
    own.routines,
    createWebToolkit({
      apiKey: unquote(env.TINYFISH_API_KEY),
      vault,
    }),
    createVaultToolkit({ broker: vault }),
    own.today,
    createSandboxToolkit({
      connection: sandboxConnection(env),
      vault,
      egressAllowlist: unquote(env.SANDBOX_EGRESS_ALLOWLIST),
    }),
    createCodingToolkit({ connection: sandboxConnection(env) }),
    createAttachmentsToolkit(
      createAttachmentStore({ attachmentIds: (id) => getAgentRuntime().attachmentIds(id) }),
      { sandbox: sandboxConnection(env) },
    ),
    createBrowserToolkit({
      sessions: getBrowserSessions(env),
      resolveTarget: browserTargetForConversation,
      allowedPrivateHosts: unquote(env.BROWSER_ALLOWED_PRIVATE_HOSTS) ?? undefined,
      vault,
      ownerWaits: app().ownerWaits,
    }),
    createCodeToolkit(
      env.SHELLEY_URL?.trim() || claudePlanOn(config)
        ? { store: codeStore }
        : {
            setupHint:
              "Set SHELLEY_URL, or turn on the Claude plan on the sandbox, to hand coding work to a coding agent.",
          },
    ),
    createComputerToolkit({
      sessions: getComputerSessions(env) ?? undefined,
      resolveProfile: computerProfileForConversation,
      setupHint: computerSetupHint(env),
      vault,
      ownerWaits: app().ownerWaits,
    }),
  ];
}

export function botsCapability(rt: AgentRuntime): Capability {
  return createBotsToolkit(botMessagingStore(rt));
}

function visionCapability(rt: AgentRuntime): Capability {
  return createVisionToolkit(
    createVisionStore(rt),
    createTranscriber({ catalog: () => rt.catalog, models: rt.models }),
  );
}

function botMessagingStore(rt: AgentRuntime): BotMessagingStore {
  const messagingStores = app().botMessagingStores;
  let store = messagingStores.get(rt);
  if (!store) {
    store = createBotMessagingStore(rt);
    messagingStores.set(rt, store);
  }
  return store;
}

export function getAgentRuntime(): AgentRuntime {
  const runtime = app().runtime;
  if (!runtime) {
    throw new Error("AgentRuntime is not open (server boot incomplete or test fake missing)");
  }
  return runtime;
}

export function agentRuntimeReady(): boolean {
  return app().runtimeReady;
}

function autoReviewer(runtime: () => AgentRuntime | undefined): Reviewer {
  const classifier = createClassifier({
    catalog: () => runtime()!.catalog,
    models: { classify: (...args) => tracedClassify(runtime()!, ...args) },
  });
  return createReviewer(classifier, {
    onReview: ({ tool, verdict, durationMs }) =>
      verdict.error
        ? logger.warn({ tool, ...verdict, durationMs }, "Auto-review failed; asking the owner")
        : logger.info({ tool, ...verdict, durationMs }, "Auto-review"),
  });
}

async function tracedClassify(
  runtime: AgentRuntime,
  ...args: Parameters<AgentRuntime["models"]["classify"]>
): ReturnType<AgentRuntime["models"]["classify"]> {
  const [model] = args;
  const startedAt = performance.now();
  const base = { purpose: "Auto-review", provider: model.provider, model: model.id };
  try {
    const result = await runtime.models.classify(...args);
    await recordLlmCall({
      ...base,
      usage: result.usage,
      durationMs: performance.now() - startedAt,
      outcome:
        result.stopReason === "stop" ? "ok" : result.stopReason === "aborted" ? "aborted" : "error",
      error: result.errorMessage,
    });
    return result;
  } catch (error) {
    await recordLlmCall({
      ...base,
      durationMs: performance.now() - startedAt,
      outcome: "error",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function openAgentRuntime(
  options: RuntimeOptions & { env: RuntimeEnv },
): Promise<AgentRuntime> {
  const { env, ...rest } = options;
  const appVars = appEnv(env);
  const modelConfig = await loadModelConfig();
  let opened: AgentRuntime | undefined;
  const instance = await AgentRuntime.open({
    ...rest,
    modelConfig,
    credentials: vaultCredentials,
    approvalTracker: app().ownerWaits,
    reviewer: rest.reviewer ?? autoReviewer(() => opened),
    ownerUserId: rest.ownerUserId ?? ownerUserId,
    capabilities: [...builtinCapabilities(appVars, modelConfig), ...(rest.capabilities ?? [])],
    claudeWorker: rest.claudeWorker ?? sharedClaudeWorkerLocator(appVars),
  });
  opened = instance;
  instance.claudePlan.prepare();
  return finishOpen(instance);
}

function finishOpen(instance: AgentRuntime): AgentRuntime {
  instance.installCapability(botsCapability(instance));
  instance.installCapability(visionCapability(instance));
  bindModelRuntime(instance);
  const missing = missingToolkits(instance.listCapabilities().map((c) => c.id));
  if (missing.length > 0) {
    logger.warn({ missing }, "Bots select toolkits the runtime has not installed");
  }
  app().runtime = instance;
  app().runtimeReady = true;
  return instance;
}

export async function closeAgentRuntime(): Promise<void> {
  const root = app();
  root.runtimeReady = false;
  bindModelRuntime(undefined);
  const instance = root.runtime;
  root.runtime = undefined;
  await instance?.close();
}

const FAUX_ASK: ToolCall["arguments"] = {
  questions: [
    {
      question: "Which stack should the project use?",
      options: [
        { label: "React", description: "With Vite and Tailwind" },
        { label: "Svelte" },
        { label: "Plain HTML" },
      ],
    },
    {
      question: "Which extras do you want?",
      description: "Pick as many as you like.",
      options: [{ label: "Auth" }, { label: "Dark mode" }, { label: "Tests" }],
      multiple: true,
    },
    { question: "Anything else I should know?" },
  ],
};

function fauxCodingCall(text: string): ToolCall | undefined {
  const [, command = "", rest = ""] =
    /^\/(bash|sleep|read|find|write|edit)\s+([\s\S]+)/m.exec(text) ?? [];
  const [path = "", body = ""] = rest.split(/\s+([\s\S]*)/);
  switch (command) {
    case "bash":
      return fauxToolCall("bash", { command: rest });
    case "sleep":
      return fauxToolCall("bash", {
        command: `sleep ${Number.parseFloat(rest) >= 0 ? Number.parseFloat(rest) : 1}`,
      });
    case "read":
      return fauxToolCall("read", { path: rest.trim() });
    case "find":
      return fauxToolCall("find", { query: rest.trim() });
    case "write":
      return fauxToolCall("write", { path, content: body });
    case "edit": {
      const [oldText = "", newText = ""] = body.split(" => ");
      return fauxToolCall("edit", { path, old_text: oldText, new_text: newText });
    }
    default:
      return undefined;
  }
}

export async function openFauxAgentRuntime(
  storePath: string,
  options: Pick<RuntimeOptions, "onFatal" | "onReport"> & { env: RuntimeEnv },
): Promise<AgentRuntime> {
  const { env, ...handlers } = options;
  const appVars = appEnv(env);
  const { createModels } = await import("@earendil-works/pi-ai/models");
  const { fauxProvider } = await import("@earendil-works/pi-ai/providers/faux");

  const textOf = (message: PiContext["messages"][number]) =>
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((b) => b.type === "text")
          .map((b) => (b as { text: string }).text)
          .join("");
  const echo = (context: PiContext) => {
    const last = context.messages.at(-1);
    let text = "";
    let toolResults = 0;
    for (let i = context.messages.length - 1; i >= 0; i--) {
      const message = context.messages[i];
      if (message.role === "toolResult") toolResults++;
      if (message.role !== "user") continue;
      text = textOf(message);
      break;
    }
    const browse = /^\/browse(?:\s+(\d+))?/.exec(text);
    if (browse && toolResults === 0) {
      const call = fauxAssistantMessage(
        fauxToolCall("tool_search", { query: "browser_snapshot", limit: 1 }),
      );
      return { ...call, stopReason: "toolUse" as const };
    }
    if (browse && toolResults - 1 < Math.min(Number(browse[1] ?? 1), 10)) {
      const call = fauxAssistantMessage(fauxToolCall("browser_snapshot", {}));
      return { ...call, stopReason: "toolUse" as const };
    }
    if (text.startsWith("/trace")) {
      if (toolResults === 0) {
        const call = fauxAssistantMessage([
          fauxThinking("The owner wants a status check. Their open tasks are the place to start."),
          fauxText("Let me look at your open tasks first."),
          fauxToolCall("list_tasks", { status: "todo" }),
        ]);
        return { ...call, stopReason: "toolUse" as const };
      }
      return fauxAssistantMessage([
        fauxThinking("The tasks are listed. Summarize them in one line."),
        fauxText(`Here is where things stand:\n\n- **Tasks:** ${textOf(last!)}`),
      ]);
    }
    if (last?.role === "toolResult") return fauxAssistantMessage(fauxText(`Echo: ${textOf(last)}`));
    if (text.startsWith("/ask")) {
      const ask = fauxAssistantMessage(fauxToolCall("ask_owner", FAUX_ASK));
      return { ...ask, stopReason: "toolUse" as const };
    }
    const coding = toolResults === 0 ? fauxCodingCall(text) : undefined;
    if (coding) return { ...fauxAssistantMessage(coding), stopReason: "toolUse" as const };
    const code = /^\/code\s+(?:cwd=(\S+)\s+)?([\s\S]+)/.exec(text);
    if (code && toolResults === 0) {
      const call = fauxAssistantMessage(
        fauxToolCall("code_start", { task: code[2], ...(code[1] ? { cwd: code[1] } : {}) }),
      );
      return { ...call, stopReason: "toolUse" as const };
    }
    const improve = /^\/improve(?:\s+(long))?/.exec(text);
    if (improve && toolResults === 0) {
      const append = improve[1]
        ? "Self-improvement e2e: a deliberately long change so the approval " +
          "card folds it behind Read more.\n" +
          "The owner must be able to read the whole proposal before " +
          "approving it — a 60-character slice of a 700-word rewrite is " +
          "rubber-stamping.\n" +
          "This line exists only to push the payload over the fold threshold."
        : "Self-improvement e2e: append this line.";
      const call = fauxAssistantMessage(
        fauxToolCall("update_instructions", {
          append,
        }),
      );
      return { ...call, stopReason: "toolUse" as const };
    }
    const newBot = /^\/newbot\s+(.+)/.exec(text);
    if (newBot && toolResults === 0) {
      const call = fauxAssistantMessage(
        fauxToolCall("create_bot", {
          name: newBot[1],
          description: "Made by the bot-builder e2e",
          instructions: "You help the owner with the bot-builder e2e.",
        }),
      );
      return { ...call, stopReason: "toolUse" as const };
    }
    return fauxAssistantMessage(fauxText(`Echo: ${text}`));
  };

  const models = createModels();
  const tokensPerSecond = Number(appVars.TINY_AGENTS_FAUX_TOKENS_PER_SECOND);
  const faux = fauxProvider({
    provider: "faux",
    models: [{ id: TEST_MODEL, name: "Test Model (faux)", reasoning: true }],
    ...(Number.isFinite(tokensPerSecond) && tokensPerSecond > 0 ? { tokensPerSecond } : {}),
  });
  faux.setResponses(Array.from({ length: 1000 }, () => echo));
  models.setProvider(faux.provider);

  await seedFauxModels();
  const modelConfig = await loadModelConfig();
  const instance = await AgentRuntime.open({
    ...handlers,
    storePath,
    models,
    modelConfig,
    credentials: vaultCredentials,
    lockWaitMs: 5_000,
    approvalTracker: app().ownerWaits,
    capabilities: builtinCapabilities(appVars, modelConfig),
    settings: { retry: { enabled: false } },
  });
  return finishOpen(instance);
}
