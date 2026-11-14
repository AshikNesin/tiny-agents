/**
 * Labels Settings → Models shows for kinds, statuses and roles (issue #179).
 */
import type { StatusVariant } from "@groot/ui/status-badge";
import type { Account, ModelRole, ProviderKind } from "../../../../shared/api/models";

export const KIND_LABEL: Record<ProviderKind, string> = {
  anthropic: "Anthropic",
  "openai-chat": "OpenAI Chat",
  "openai-responses": "OpenAI Responses",
  gemini: "Gemini",
  "cloudflare-ai-gateway": "Cloudflare AI Gateway",
  "claude-plan": "Claude plan",
  faux: "Faux",
};

/** The kinds the dialog offers, in order. */
export const KINDS: Exclude<ProviderKind, "faux">[] = [
  "anthropic",
  "openai-chat",
  "openai-responses",
  "gemini",
  "cloudflare-ai-gateway",
  "claude-plan",
];

export function accountStatus(account: Account): { variant: StatusVariant; label: string } {
  if (!account.enabled) return { variant: "cancelled", label: "Disabled" };
  switch (account.status) {
    case "ok":
      return { variant: "success", label: "Connected" };
    case "key_rejected":
      return { variant: "failed", label: "Key rejected" };
    case "unreachable":
      return { variant: "failed", label: "Unreachable" };
    case "locked":
      return { variant: "warning", label: "Locked: re-enter key" };
    default:
      return { variant: "pending", label: "Not checked" };
  }
}

export const ROLE_LABEL: Record<ModelRole, { title: string; description: string }> = {
  bot_default: {
    title: "New bots",
    description: "Pre-selected in New bot, and used by bots without a model.",
  },
  memory_capture: {
    title: "Memory capture",
    description: "Unset: the bot's own model on pi, else the default.",
  },
  chat_title: {
    title: "Past chat titles",
    description: "Unset: the bot's own model on pi, else the default.",
  },
  vision: {
    title: "Image transcription",
    description: "For bots whose model can't see images. Unset: the first that can.",
  },
  classifier: {
    title: "Auto-review",
    description: "A classifier model. Unset: auto-review asks you every time.",
  },
};

export const ROLES = Object.keys(ROLE_LABEL) as ModelRole[];

/** "200K", "1M": a context window as the picker shows it. */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

/** The host an account reaches, for its card. */
export function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
