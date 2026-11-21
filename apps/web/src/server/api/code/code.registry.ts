import { logger } from "@groot/core/logger";
import {
  createClaudeCodeHarness,
  createShelleyHarness,
  shelley,
  type HarnessHost,
  type HarnessInstance,
  type InstanceStatus,
} from "@tiny-agents/code/server";
import type { ModelOption } from "@tiny-agents/code/contracts";
import { appEnv, type AppEnv } from "../../env";
import { sharedClaudeWorkerLocator } from "../bots/claude-worker";
import { agentRuntimeReady, getAgentRuntime } from "../bots/bots.runtime";
import { threadIndex } from "./code.store";

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

export function buildHarnesses(options: RegistryOptions = {}): HarnessInstance[] {
  const env = options.env ?? appEnv();
  const host = options.host ?? harnessHost();
  const instances: HarnessInstance[] = [];
  const url = shelleyUrl(env);
  if (url) instances.push(createShelleyHarness({ url, host }));
  const claude = claudeCodeHarness(env, host);
  if (claude) instances.push(claude);
  instances.push(...(options.extra ?? []));
  return instances;
}
