import { logger } from "@groot/core/logger";
import {
  ApprovalNotPendingError,
  codingSelection,
  ForkPointNotFoundError,
  InvalidAnswersError,
  ModelUnavailableError,
  QuestionNotPendingError,
  type AgentRuntime,
  type BotAgentConfig,
} from "@tiny-agents/agent";
import {
  createClaudeCodeHarness,
  createPiHarness,
  createShelleyHarness,
  HarnessError,
  shelley,
  type HarnessHost,
  type HarnessInstance,
  type InstanceStatus,
  type PiPort,
  type PiThreadConfig,
} from "@tiny-agents/code/server";
import type { ModelOption } from "@tiny-agents/code/contracts";
import { appEnv, type AppEnv } from "../../env";
import { TOOL_SEARCH_TOOLKIT } from "../bots/bot-toolkits";
import { ownerToolPermissions } from "../bots/tool-permissions";
import { sharedClaudeWorkerLocator } from "../bots/claude-worker";
import { agentRuntimeReady, getAgentRuntime } from "../bots/bots.runtime";
import { sandboxConnection } from "../bots/sandbox-host";
import { threadIndex } from "./code.store";
import { claudeCodeTools, sharedConnectionToolkits } from "./code.tools";

function harnessHost(): HarnessHost {
  return {
    logger: {
      info: (message, fields) => logger.info(fields ?? {}, message),
      warn: (message, fields) => logger.warn(fields ?? {}, message),
      error: (message, fields) => logger.error(fields ?? {}, message),
    },
    index: threadIndex,
    now: () => new Date(),
  };
}

function shelleyUrl(env: AppEnv = appEnv()): string | undefined {
  return shelley.trimUrl(env.SHELLEY_URL);
}

export interface RegistryOptions {
  env?: AppEnv;
  host?: HarnessHost;
  extra?: HarnessInstance[];
}

function claudeCodeHarness(env: AppEnv, host: HarnessHost): HarnessInstance | undefined {
  if (!agentRuntimeReady() || !getAgentRuntime().catalog.claudePlan()?.enabled) return undefined;
  const locator = sharedClaudeWorkerLocator(env);
  if (!locator) return undefined;
  let hint: InstanceStatus | undefined;
  const readLogin = () =>
    void locator
      .account()
      .then((account) => {
        hint =
          account.state === "ready" && !account.subscription
            ? {
                state: "reconnecting",
                detail: "Sign Claude Code in: Settings → Models → Claude plan → Sign in.",
              }
            : account.state === "installing"
              ? { state: "connecting", detail: "Setting up Claude Code on the sandbox…" }
              : account.state === "error"
                ? { state: "reconnecting", detail: account.detail }
                : undefined;
      })
      .catch(() => undefined);
  readLogin();
  setInterval(readLogin, 5 * 60_000).unref?.();
  return createClaudeCodeHarness({
    host,
    resolveWorker: () => locator.resolve(),
    tools: claudeCodeTools(),
    status: () => hint ?? { state: "connected" },
    models: claudePlanModels,
  });
}

function claudePlanModels(): ModelOption[] {
  if (!agentRuntimeReady()) return [];
  return getAgentRuntime()
    .catalog.list({ type: "chat", enabledOnly: true })
    .filter((model) => model.providerKind === "claude-plan" && model.available)
    .map((model) => ({
      id: model.upstreamId,
      label: model.name,
      contextWindow: model.contextWindow,
      supportsReasoning: model.reasoning,
      supportsImages: model.vision,
    }));
}

function nativeModels(runtime: AgentRuntime): ModelOption[] {
  const { catalog } = runtime;
  const start = catalog.forRole("code_default")?.id;
  return catalog
    .list({ type: "chat", enabledOnly: true })
    .filter((model) => model.engine === "pi" && model.available)
    .map((model) => ({
      id: model.id,
      label: model.name,
      ...(model.id === start ? { isDefault: true } : {}),
      contextWindow: model.contextWindow,
      supportsReasoning: model.reasoning,
      supportsImages: model.vision,
    }))
    .sort((a, b) => Number(b.isDefault ?? false) - Number(a.isDefault ?? false));
}

async function nativeConfig(config: PiThreadConfig): Promise<BotAgentConfig> {
  const [shared, owner] = await Promise.all([sharedConnectionToolkits(), ownerToolPermissions()]);
  const coding = codingSelection(config.permissionMode);
  return {
    systemPrompt: "",
    modelId: config.modelId,
    cwd: config.cwd,
    capabilities: {
      enabled: [...coding.enabled, ...shared, ...(shared.length > 0 ? [TOOL_SEARCH_TOOLKIT] : [])],
      permissions: { ...owner, ...coding.permissions },
    },
  };
}

function asHarnessError(error: unknown): never {
  if (
    error instanceof ModelUnavailableError ||
    error instanceof ForkPointNotFoundError ||
    error instanceof InvalidAnswersError
  ) {
    throw new HarnessError(400, error.message);
  }
  if (error instanceof ApprovalNotPendingError || error instanceof QuestionNotPendingError) {
    throw new HarnessError(409, "That request is no longer waiting for an answer.");
  }
  throw error;
}

export function agentRuntimePort(runtime: () => AgentRuntime): PiPort {
  return {
    models: () => nativeModels(runtime()),
    create: async (config) =>
      runtime()
        .createConversation(await nativeConfig(config))
        .catch(asHarnessError),
    configure: async (ref, config) =>
      runtime()
        .configure(ref, await nativeConfig(config))
        .catch(asHarnessError),
    submit: (ref, input) => runtime().submit(ref, input),
    abort: (ref) => runtime().abort(ref),
    withdraw: (ref, requestId) => runtime().withdraw(ref, requestId),
    fork: (ref, atMessageId) => runtime().fork(ref, atMessageId).catch(asHarnessError),
    compact: (ref, instructions) => runtime().compact(ref, instructions),
    continueReply: (ref) => runtime().continueReply(ref),
    decideApproval: (ref, taskId, decision) =>
      runtime().decideApproval(ref, taskId, decision).catch(asHarnessError),
    answerQuestions: (ref, taskId, answers) =>
      runtime().answerQuestions(ref, taskId, answers).catch(asHarnessError),
    isBusy: (ref) => runtime().isBusy(ref),
    costUsd: async (ref) => (await runtime().usage(ref)).costUsd,
    read: (ref) => runtime().readChat(ref),
    watch: (ref, listener) => runtime().watchChat(ref, listener),
    onActivity: (listener) => runtime().onActivity(listener),
  };
}

function nativeHarness(env: AppEnv, host: HarnessHost): HarnessInstance | undefined {
  if (!agentRuntimeReady() || !sandboxConnection(env)) return undefined;
  return createPiHarness({ host, port: agentRuntimePort(getAgentRuntime) });
}

export function buildHarnesses(options: RegistryOptions = {}): HarnessInstance[] {
  const env = options.env ?? appEnv();
  const host = options.host ?? harnessHost();
  const instances: HarnessInstance[] = [];
  const url = shelleyUrl(env);
  if (url) instances.push(createShelleyHarness({ url, host }));
  const claude = claudeCodeHarness(env, host);
  if (claude) instances.push(claude);
  const native = nativeHarness(env, host);
  if (native) instances.push(native);
  instances.push(...(options.extra ?? []));
  return instances;
}
