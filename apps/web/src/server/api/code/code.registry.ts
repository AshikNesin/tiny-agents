/**
 * Which harnesses this server runs (ADR 0011). Adding a harness is one
 * driver in `@tiny-agents/code` and one entry here, read from config:
 *
 * - `shelley`: the owner's Shelley, when `SHELLEY_URL` is set (ADR 0009).
 * - `claude-code`: Claude Code on the sandbox, through the Claude worker's
 *   coding mode, when `CLAUDE_CODE_ENGINE_ENABLED` is on and a sandbox is
 *   configured (ADR 0010, ADR 0012).
 */
import { logger } from "@groot/core/logger";
import { claudeCodeEngineEnabled } from "@tiny-agents/agent";
import {
  createClaudeCodeHarness,
  createShelleyHarness,
  shelley,
  type HarnessHost,
  type HarnessInstance,
  type InstanceStatus,
} from "@tiny-agents/code/server";
import { appEnv, type AppEnv } from "../../env";
import { sharedClaudeWorkerLocator } from "../bots/claude-worker";
import { threadIndex } from "./code.store";

export function harnessHost(): HarnessHost {
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

/** Shelley's base URL, or undefined when `SHELLEY_URL` is not set. */
export function shelleyUrl(env: AppEnv = appEnv()): string | undefined {
  return shelley.trimUrl(env.SHELLEY_URL);
}

export interface RegistryOptions {
  env?: AppEnv;
  host?: HarnessHost;
  /** Extra instances (tests). */
  extra?: HarnessInstance[];
}

/**
 * Claude Code on the sandbox, when the Claude plan is on and a sandbox is
 * configured. The worker locator is the one bot chats use; the login state
 * (read in the background) explains a harness that cannot run yet.
 */
function claudeCodeHarness(env: AppEnv, host: HarnessHost): HarnessInstance | undefined {
  if (!claudeCodeEngineEnabled(env)) return undefined;
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
                detail: "Sign Claude Code in: Settings → Claude plan → Sign in.",
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
  });
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
