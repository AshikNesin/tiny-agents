/**
 * Failures of the Claude plan engine. `fallback` is what the runtime should
 * do next: pause the turn, or hand it to the gateway. The worker is not
 * involved in the kill switch.
 */
import type { ClaudeEngineFallback } from "../../engine";

export type ClaudeEngineErrorCode =
  | "disabled"
  | "unconfigured"
  | "unreachable"
  | "usage"
  | "rejected"
  | "paused";

export class ClaudeEngineError extends Error {
  constructor(
    message: string,
    readonly code: ClaudeEngineErrorCode,
    readonly fallback: ClaudeEngineFallback,
  ) {
    super(message);
    this.name = "ClaudeEngineError";
  }
}

export function pauseMessage(detail: string): string {
  return `${detail} The turn was not sent. Set CLAUDE_CODE_ENGINE_FALLBACK=gateway to send it through Cloudflare AI Gateway instead.`;
}
