/**
 * tiny-agents notification events (issue #57): the switches Settings shows
 * and one typed template per event. Templates are the only place a
 * notification's text is built — tool names and bot/routine names come from
 * the app, every piece of model-authored or error text goes through
 * `scrubText`, and nothing ever includes tool arguments or outputs.
 */
import type { Notification, NotificationEventDef } from "@groot/core/notification/notifier";
import { scrubText } from "@groot/core/notification/scrub";

export const NOTIFICATION_EVENTS: NotificationEventDef[] = [
  {
    event: "approval.requested",
    label: "Approval needed",
    description: "A bot wants to run a tool that asks first.",
    category: "needs_input",
    defaultEnabled: true,
  },
  {
    event: "question.asked",
    label: "Question asked",
    description: "A bot asked you clarifying questions and is waiting.",
    category: "needs_input",
    defaultEnabled: true,
  },
  {
    event: "credential.requested",
    label: "Sign-in needed",
    description: "A bot asked you to fill in a login it does not have.",
    category: "needs_input",
    defaultEnabled: true,
  },
  {
    event: "input.reminder",
    label: "Still waiting reminder",
    description: "One reminder when an approval or question is still unanswered.",
    category: "needs_input",
    defaultEnabled: true,
  },
  {
    event: "routine.succeeded",
    label: "Routine finished",
    description: "A quiet push with a preview of the routine's reply.",
    category: "notify",
    defaultEnabled: true,
  },
  {
    event: "routine.failed",
    label: "Routine failed",
    description: "A routine failed, was missed or was paused.",
    category: "notify",
    defaultEnabled: true,
  },
  {
    event: "run.failed",
    label: "Reply failed",
    description: "A bot's reply ended in a model error while you were away.",
    category: "notify",
    defaultEnabled: true,
  },
  {
    event: "run.long_done",
    label: "Long reply finished",
    description: "A long-running reply finished while you were away.",
    category: "notify",
    defaultEnabled: true,
  },
  {
    event: "vault.alert",
    label: "Vault alerts",
    description: "A vault value was revealed or an item deleted, or a bot was refused a fill.",
    category: "security",
    defaultEnabled: true,
    locked: true,
  },
];

export interface BotRef {
  id: string;
  name: string;
  conversationId: number;
}

const chatPath = (bot: BotRef, focus?: string) =>
  `/chats/${encodeURIComponent(bot.id)}${focus ? `?focus=${encodeURIComponent(focus)}` : ""}`;

export const waitKey = (kind: "approval" | "question", conversation: number, task: number) =>
  `${kind}:${conversation}:${task}`;

/** Approvals and questions of one chat within the coalescing window: one push. */
function needsYou(bot: BotRef): Notification["coalesce"] {
  return {
    key: `needs:${bot.conversationId}`,
    summarize: (batch) => {
      const approvals = batch.filter((n) => n.event === "approval.requested").length;
      const questions = batch.length - approvals;
      const parts = [
        approvals > 0 ? `${approvals} approval${approvals === 1 ? "" : "s"}` : undefined,
        questions > 0 ? `${questions} question${questions === 1 ? "" : "s"}` : undefined,
      ].filter(Boolean);
      return {
        title: `✋ ${bot.name} needs you`,
        message: `${parts.join(" and ")} waiting. Open the chat to answer.`,
      };
    },
  };
}

/** Seconds until `expiresAt`, for a push that should vanish with its request. */
const ttlUntil = (expiresAt: number | undefined) =>
  expiresAt === undefined
    ? {}
    : { ttlSeconds: Math.max(1, Math.round((expiresAt - Date.now()) / 1000)) };

export function approvalRequested(
  bot: BotRef,
  task: number,
  tool: string,
  options: { subject?: string; expiresAt?: number } = {},
): Notification {
  const subject = scrubText(options.subject, 120);
  return {
    event: "approval.requested",
    category: "needs_input",
    title: `✋ ${bot.name} needs approval`,
    message: subject
      ? `Wants to use ${subject} (${tool}). Open the chat to approve or deny.`
      : `Wants to run ${tool}. Open the chat to approve or deny.`,
    ...ttlUntil(options.expiresAt),
    path: chatPath(bot, `approval:${task}`),
    urlTitle: "Open approval",
    priority: 1,
    dedupeKey: waitKey("approval", bot.conversationId, task),
    botId: bot.id,
    coalesce: needsYou(bot),
  };
}

export function credentialRequested(
  bot: BotRef,
  task: number,
  subject: string | undefined,
  expiresAt: number | undefined,
): Notification {
  return {
    event: "credential.requested",
    category: "needs_input",
    title: `🔑 ${bot.name}: sign-in needed`,
    message: `${scrubText(subject, 160) ?? "A site needs your login"}. Open the request to fill it in.`,
    path: `/vault/requests/${task}`,
    urlTitle: "Open request",
    priority: 1,
    ...ttlUntil(expiresAt),
    dedupeKey: waitKey("approval", bot.conversationId, task),
    botId: bot.id,
  };
}

export function questionAsked(bot: BotRef, task: number, preview?: string): Notification {
  return {
    event: "question.asked",
    category: "needs_input",
    title: `❓ ${bot.name} has a question`,
    message: scrubText(preview) ?? "Open the chat to answer.",
    path: chatPath(bot, `question:${task}`),
    urlTitle: "Answer",
    priority: 1,
    dedupeKey: waitKey("question", bot.conversationId, task),
    botId: bot.id,
    coalesce: needsYou(bot),
  };
}

export function inputReminder(
  bot: BotRef,
  kind: "approval" | "question",
  task: number,
  minutes: number,
): Notification {
  return {
    event: "input.reminder",
    category: "needs_input",
    title: `⏰ ${bot.name} is still waiting`,
    message: `${kind === "approval" ? "An approval" : "A question"} has been waiting for ${minutes} min.`,
    path: chatPath(bot, `${kind}:${task}`),
    urlTitle: kind === "approval" ? "Open approval" : "Answer",
    priority: 1,
    dedupeKey: `reminder:${waitKey(kind, bot.conversationId, task)}`,
    botId: bot.id,
  };
}

export interface RoutineRunRef {
  runId: string;
  routineName: string;
  bot: { id: string; name: string };
}

export function routineSucceeded(run: RoutineRunRef, output?: string | null): Notification {
  const preview = scrubText(output);
  return {
    event: "routine.succeeded",
    category: "notify",
    title: `✅ ${run.routineName}`,
    message: preview ? `${run.bot.name}: ${preview}` : `${run.bot.name} finished the routine.`,
    path: "/routines",
    urlTitle: "Open routines",
    priority: -1,
    ttlSeconds: 24 * 60 * 60,
    dedupeKey: `routine:${run.runId}:succeeded`,
    botId: run.bot.id,
  };
}

export type RoutineFailure = "failed" | "missed" | "paused";

export function routineFailed(
  run: RoutineRunRef,
  failure: RoutineFailure,
  reason?: string | null,
): Notification {
  const title =
    failure === "paused"
      ? `⏸️ ${run.routineName} paused`
      : failure === "missed"
        ? `⏭️ ${run.routineName} missed`
        : `❌ ${run.routineName} failed`;
  const fallback =
    failure === "paused"
      ? "Its prompt could not be submitted. Fix the bot and resume the routine."
      : failure === "missed"
        ? "The run was too late to start."
        : "The routine's reply failed.";
  return {
    event: "routine.failed",
    category: "notify",
    title,
    message: scrubText(reason) ?? fallback,
    path: failure === "paused" ? `/chats/${encodeURIComponent(run.bot.id)}` : "/routines",
    urlTitle: failure === "paused" ? "Open chat" : "Open routines",
    priority: 0,
    dedupeKey: `routine:${run.runId}:${failure}`,
    botId: run.bot.id,
  };
}

export function runFailed(bot: BotRef, replyAt: number, error?: string): Notification {
  return {
    event: "run.failed",
    category: "notify",
    title: `⚠️ ${bot.name}: reply failed`,
    message: scrubText(error) ?? "The model returned an error.",
    path: chatPath(bot),
    urlTitle: "Open chat",
    priority: 0,
    dedupeKey: `run-failed:${bot.conversationId}:${replyAt}`,
    botId: bot.id,
  };
}

export function runLongDone(
  bot: BotRef,
  replyAt: number,
  minutes: number,
  text?: string,
): Notification {
  return {
    event: "run.long_done",
    category: "notify",
    title: `✅ ${bot.name} finished`,
    message: scrubText(text) ?? `Done after ${minutes} min.`,
    path: chatPath(bot),
    urlTitle: "Open chat",
    priority: -1,
    dedupeKey: `long-done:${bot.conversationId}:${replyAt}`,
    botId: bot.id,
  };
}

export type VaultAlertKind = "revealed" | "deleted" | "refused";

/** Security alerts (cannot be switched off): the vault's own events. */
export function vaultAlert(kind: VaultAlertKind, title: string, message: string): Notification {
  return {
    event: "vault.alert",
    category: "security",
    title: `🛡️ ${title}`,
    message,
    path: "/vault",
    urlTitle: "Open vault",
    priority: 1,
    dedupeKey: `vault:${kind}:${Date.now()}:${Math.random()}`,
  };
}

export function systemStarted(environment: string): Notification {
  return {
    event: "system.started",
    category: "system",
    title: "🚀 tiny-agents started",
    message: `Environment: ${environment}`,
    path: "/",
    priority: -2,
    dedupeKey: `started:${Date.now()}`,
  };
}
