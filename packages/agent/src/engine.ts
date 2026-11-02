/**
 * Inference engine seam. `pi` is the pi-durable harness (default).
 * `claude-code` sends turns to the Claude Code worker, which drives the
 * official Agent SDK. The model id `claude-code/<model>` selects it.
 */
import type { AgentEngineKind, BotAgentConfig } from "./types";

export type { AgentEngineKind };

export const CLAUDE_CODE_MODEL_PREFIX = "claude-code/";

/** Picker note shown beside every Claude plan model. */
export const CLAUDE_PLAN_NOTE = "uses your Claude plan";

export interface AgentEngine {
  readonly kind: AgentEngineKind;
}

/** The engine a model id selects. Anything other than `claude-code/…` is pi. */
export function engineKindForModel(modelId: string): AgentEngineKind {
  return claudeCodeBareModel(modelId) ? "claude-code" : "pi";
}

/**
 * The engine a bot config selects. An explicit `engine` must agree with the
 * model id so a saved bot cannot claim one engine and run the other.
 */
export function engineKindForConfig(
  config: Pick<BotAgentConfig, "modelId" | "engine">,
): AgentEngineKind {
  const fromId = engineKindForModel(config.modelId);
  if (config.engine && config.engine !== fromId) {
    throw new Error(`Bot engine "${config.engine}" does not match model "${config.modelId}".`);
  }
  return fromId;
}

/**
 * Model id Claude Code should run (`claude-sonnet-4-6`), or undefined when
 * the id is not a Claude plan selection. Rejects empty, whitespace, and
 * extra slashes so the id cannot smuggle a path or a second provider.
 */
export function claudeCodeBareModel(modelId: string): string | undefined {
  if (!modelId.startsWith(CLAUDE_CODE_MODEL_PREFIX)) return undefined;
  const bare = modelId.slice(CLAUDE_CODE_MODEL_PREFIX.length);
  if (!bare || /\s/.test(bare) || bare.includes("/")) return undefined;
  return bare;
}

/** Kill switch. Read on each turn so flipping it does not require a worker redeploy. */
export function claudeCodeEngineEnabled(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const value = env.CLAUDE_CODE_ENGINE_ENABLED?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export type ClaudeEngineFallback = "gateway" | "pause";

/** What a turn does when the engine is off or the worker is unreachable. Default: pause. */
export function claudeCodeFallback(
  env: Readonly<Record<string, string | undefined>>,
): ClaudeEngineFallback {
  return env.CLAUDE_CODE_ENGINE_FALLBACK?.trim().toLowerCase() === "gateway" ? "gateway" : "pause";
}
