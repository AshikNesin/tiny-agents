import { logger } from "@groot/core/logger";
import type { Notification } from "@groot/core/notification/notifier";
import { notificationService } from "@groot/core/notification/notification.service";
import { registerRedactor } from "@groot/core/notification/scrub";
import {
  finishedReplyOf,
  secretRedactor,
  type AgentRuntime,
  type WaitEvent,
} from "@tiny-agents/agent";
import { isBotWatched } from "../bots/bots.viewers";
import { chatOwner } from "../bots/bots.owner";
import type { SettledStep } from "../bots/bots.settled";
import {
  approvalActions,
  approvalRequested,
  credentialRequested,
  inputReminder,
  NOTIFICATION_EVENTS,
  questionAsked,
  routineFailed,
  routinePausedBlocked,
  routineSucceeded,
  botMessage,
  takeoverRequested,
  runFailed,
  runLongDone,
  waitKey,
  type BotRef,
  type RoutineFailure,
  type RoutineRunRef,
  type VaultAlertKind as EventVaultAlertKind,
  vaultAlert,
} from "./notifications.events";

export type Notifier = Pick<
  typeof notificationService,
  "notify" | "cancel" | "getSettings" | "defineEvents"
>;

export type NotificationsRuntime = Pick<AgentRuntime, "onWait">;

export interface NotificationsWiring {
  stop(): void;
}

async function botFor(conversation: number): Promise<BotRef | undefined> {
  const bot = await chatOwner(conversation);
  return bot ? { id: bot.id, name: bot.name, conversationId: conversation } : undefined;
}

export function startNotifications(
  runtime: NotificationsRuntime,
  notifier: Notifier = notificationService,
): NotificationsWiring {
  notifier.defineEvents(NOTIFICATION_EVENTS);
  const offRedactor = registerRedactor((text) => secretRedactor.scrub(text));
  const reminders = new Map<string, ReturnType<typeof setTimeout>>();

  const send = (n: Notification) => notifier.notify(n);

  async function onAdded(event: WaitEvent): Promise<void> {
    const bot = await botFor(event.conversation);
    if (!bot) return;
    const plainApproval =
      event.kind === "approval" &&
      event.tool !== undefined &&
      event.tool !== "request_credentials" &&
      event.tool !== "computer_request_takeover";
    const actions = plainApproval
      ? approvalActions(bot, event.task, event.tool!, event.vault)
      : undefined;
    send(
      event.kind === "question"
        ? questionAsked(bot, event.task, event.preview)
        : event.tool === "request_credentials"
          ? credentialRequested(bot, event.task, event.subject, event.expiresAt)
          : event.tool === "computer_request_takeover"
            ? takeoverRequested(bot, event.task, event.preview)
            : approvalRequested(bot, event.task, event.tool ?? "a tool", { ...event, actions }),
    );
    const { reminderMinutes } = await notifier.getSettings();
    const key = waitKey(event.kind, event.conversation, event.task);
    if (reminderMinutes <= 0 || reminders.has(key)) return;
    if (event.expiresAt !== undefined && event.expiresAt <= Date.now() + reminderMinutes * 60_000) {
      return;
    }
    const timer = setTimeout(() => {
      reminders.delete(key);
      send(inputReminder(bot, event.kind, event.task, reminderMinutes, actions));
    }, reminderMinutes * 60_000);
    timer.unref?.();
    reminders.set(key, timer);
  }

  function onRemoved(event: WaitEvent): void {
    const key = waitKey(event.kind, event.conversation, event.task);
    notifier.cancel(key);
    const timer = reminders.get(key);
    if (timer) clearTimeout(timer);
    reminders.delete(key);
  }

  const offWait = runtime.onWait((event) => {
    if (event.change === "removed") {
      onRemoved(event);
      return;
    }
    void onAdded(event).catch((error: unknown) =>
      logger.warn({ error }, "Needs-input notification failed"),
    );
  });

  return {
    stop() {
      offRedactor();
      offWait();
      for (const timer of reminders.values()) clearTimeout(timer);
      reminders.clear();
    },
  };
}

export function runNotificationsStep(notifier: Notifier = notificationService): SettledStep {
  return {
    name: "run notifications",
    async run({ conversationId, chat, owner, startedAt }) {
      if (startedAt === undefined) return;
      const behind = await owner();
      if (behind?.kind !== "chat" && behind?.kind !== "delivery") return;
      if (behind.kind === "chat" && isBotWatched(behind.bot.id)) return;
      const bot: BotRef = { id: behind.bot.id, name: behind.bot.name, conversationId };
      const state = await chat();
      const fresh = state.messages.filter(
        (message) => message.role === "assistant" && message.createdAt >= startedAt,
      );
      const sent = fresh.flatMap((message) =>
        message.quiet || behind.kind === "delivery" ? (message.sent ?? []) : [],
      );
      if (sent.length > 0) {
        notifier.notify(botMessage(bot, fresh.at(-1)?.createdAt ?? startedAt, sent));
      }
      if (behind.kind !== "chat") return;
      const last = state.messages.findLast((message) => message.role === "assistant");
      const reply = last ? finishedReplyOf(last) : undefined;
      if (!reply || reply.createdAt < startedAt) return;
      if (reply.error !== undefined) {
        notifier.notify(runFailed(bot, reply.createdAt, reply.error));
        return;
      }
      if (sent.length > 0 || last?.quiet) return;
      const { longRunMinutes } = await notifier.getSettings();
      const minutes = Math.floor((Date.now() - startedAt) / 60_000);
      if (minutes >= longRunMinutes) {
        notifier.notify(runLongDone(bot, reply.createdAt, minutes, reply.text));
      }
    },
  };
}

export function notifyRoutineRun(
  run: RoutineRunRef,
  outcome: RoutineOutcome,
  notifier: Pick<Notifier, "notify"> = notificationService,
): void {
  const sent = "sent" in outcome ? outcome.sent : undefined;
  if (sent?.length) notifier.notify(routineSucceeded(run, sent.join("\n\n")));
  if (outcome.status === "blocked") {
    if (outcome.pausedReason) notifier.notify(routinePausedBlocked(run, outcome.pausedReason));
    return;
  }
  if (outcome.status === "succeeded") return;
  notifier.notify(routineFailed(run, outcome.status, outcome.error));
}

export type RoutineOutcome =
  | { status: "succeeded"; output?: string | null; sent?: string[] }
  | { status: "blocked"; error: string; pausedReason?: string | null; sent?: string[] }
  | { status: RoutineFailure; error?: string | null; sent?: string[] };

export function notifyVaultAlert(
  kind: EventVaultAlertKind,
  title: string,
  message: string,
  notifier: Pick<Notifier, "notify"> = notificationService,
): void {
  notifier.notify(vaultAlert(kind, title, message));
}
