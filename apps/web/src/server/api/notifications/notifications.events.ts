import type {
  Notification,
  NotificationActions,
  NotificationEventDef,
} from "@groot/core/notification/notifier";
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
    event: "bot.message",
    label: "Bot messages",
    description: "A bot messaged you while you were away, after work you didn't start yourself.",
    category: "notify",
    defaultEnabled: true,
  },
  {
    event: "routine.succeeded",
    label: "Routine messages",
    description:
      "A quiet push with what a routine run messaged you. Runs with nothing to say send none.",
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
    event: "shelley.update",
    label: "Code updates",
    description:
      "A coding agent's conversation you follow (Shelley, Claude Code) finished, failed or asked for you while you were away.",
    category: "notify",
    defaultEnabled: true,
  },
  {
    event: "code.autofix",
    label: "Auto-fix needs you",
    description:
      "A pull request's Auto-fix stopped for your input, switched itself off at a limit, or a check stalled.",
    category: "needs_input",
    defaultEnabled: true,
  },
  {
    event: "code.pr",
    label: "Pull request updates",
    description:
      "A Code pull request's checks went green or failed (with Auto-fix off), or it merged.",
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

const ttlUntil = (expiresAt: number | undefined) =>
  expiresAt === undefined
    ? {}
    : { ttlSeconds: Math.max(1, Math.round((expiresAt - Date.now()) / 1000)) };

export function approvalActions(
  bot: BotRef,
  task: number,
  tool: string,
  vault?: { grantable: boolean },
): NotificationActions {
  return vault
    ? { kind: "vault", botId: bot.id, taskId: task, tool, grantable: vault.grantable }
    : { kind: "tool", botId: bot.id, taskId: task, tool };
}

export function approvalRequested(
  bot: BotRef,
  task: number,
  tool: string,
  options: { subject?: string; expiresAt?: number; actions?: NotificationActions } = {},
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
    ...(options.actions ? { actions: options.actions } : {}),
  };
}

export function takeoverRequested(bot: BotRef, task: number, reason?: string): Notification {
  return {
    event: "approval.requested",
    category: "needs_input",
    title: `✋ ${bot.name} needs you on the computer`,
    message: `${scrubText(reason, 160) ?? "Take over the computer"}. Open the chat to take control.`,
    path: chatPath(bot, `takeover:${task}`),
    urlTitle: "Open chat",
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
  actions?: NotificationActions,
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
    tag: waitKey(kind, bot.conversationId, task),
    botId: bot.id,
    ...(actions ? { actions } : {}),
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

export function routinePausedBlocked(run: RoutineRunRef, reason: string): Notification {
  return {
    event: "routine.failed",
    category: "notify",
    title: `⏸️ ${run.routineName} paused`,
    message:
      scrubText(reason) ??
      "It was blocked several runs in a row. Fix what it needs, then resume it.",
    path: "/routines",
    urlTitle: "Open routines",
    priority: 0,
    dedupeKey: `routine:${run.runId}:paused-blocked`,
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

export function botMessage(bot: BotRef, replyAt: number, sent: readonly string[]): Notification {
  return {
    event: "bot.message",
    category: "notify",
    title: `💬 ${bot.name}`,
    message: scrubText(sent.join("\n\n")) ?? `${bot.name} sent you a message.`,
    path: chatPath(bot),
    urlTitle: "Open chat",
    priority: 0,
    dedupeKey: `bot-message:${bot.conversationId}:${replyAt}`,
    botId: bot.id,
  };
}

export type CodeUpdateKind = "finished" | "failed" | "message";

export function codeUpdate(
  thread: { id: string; title: string; harness: string },
  kind: CodeUpdateKind,
  text: string | undefined,
  at: number | string,
): Notification {
  const title =
    kind === "finished"
      ? `✅ ${thread.harness} finished ${thread.title}`
      : kind === "failed"
        ? `⚠️ ${thread.harness} hit an error in ${thread.title}`
        : `💬 ${thread.harness}: ${thread.title}`;
  return {
    event: "shelley.update",
    category: "notify",
    title,
    message: scrubText(text) ?? (kind === "finished" ? "The turn ended." : "Open it to see why."),
    path: `/code/${encodeURIComponent(thread.id)}`,
    urlTitle: "Open in Code",
    priority: kind === "message" ? 0 : -1,
    dedupeKey: `code:${thread.id}:${kind}:${at}`,
  };
}

export type CodePullKind = "needs_input" | "off" | "stalled" | "green" | "merged" | "checks_failed";

export function codePullUpdate(
  pull: { threadId: string; number: number; title: string },
  kind: CodePullKind,
  detail?: string,
): Notification {
  const needsYou = kind === "needs_input" || kind === "off" || kind === "stalled";
  const name = `#${pull.number}${pull.title ? ` ${pull.title}` : ""}`;
  const title = {
    needs_input: `✋ Auto-fix needs you on ${name}`,
    off: `⏹️ Auto-fix switched off on ${name}`,
    stalled: `⏳ A check stalled on ${name}`,
    green: `✅ Checks green on ${name}`,
    merged: `🎉 Merged ${name}`,
    checks_failed: `❌ Checks failed on ${name}`,
  }[kind];
  return {
    event: needsYou ? "code.autofix" : "code.pr",
    category: needsYou ? "needs_input" : "notify",
    title,
    message: scrubText(detail) ?? "Open the thread's PR tab.",
    path: `/code/${encodeURIComponent(pull.threadId)}`,
    urlTitle: "Open in Code",
    priority: needsYou ? 0 : -1,
    dedupeKey: `code-pr:${pull.threadId}:${pull.number}:${kind}:${detail ?? ""}`,
  };
}

export type VaultAlertKind = "revealed" | "deleted" | "refused";

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
