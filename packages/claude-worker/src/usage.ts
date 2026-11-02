/**
 * Pause a turn when Claude Code reports the request was rejected for credits
 * or moved onto usage-credit overage. `isUsingOverage` is undocumented; it
 * is honored only when present.
 */

export interface RateLimitInfo {
  status?: string;
  errorCode?: string;
  rateLimitType?: string;
  isUsingOverage?: boolean;
  [key: string]: unknown;
}

export function asRateLimitInfo(value: unknown): RateLimitInfo | undefined {
  if (!value || typeof value !== "object") return undefined;
  return value as RateLimitInfo;
}

/**
 * Why this turn must stop, or undefined when the event is an ordinary
 * rate-limit notice that does not move the request onto credits.
 */
export function usagePauseReason(info: RateLimitInfo | undefined): string | undefined {
  if (!info) return undefined;
  if (info.status === "rejected") return "rate limit status rejected";
  if (info.errorCode === "credits_required") return "errorCode credits_required";
  if (info.isUsingOverage === true) return "isUsingOverage";
  return undefined;
}

export function usagePauseMessage(reason: string): string {
  return (
    "Claude plan paused: this turn was rejected or charged to usage credits " +
    `(${reason}). tiny-agents will not retry it. ` +
    "Check the plan limit at claude.ai/settings/usage. No Claude credential was read."
  );
}
