/**
 * Where tiny-agents tells the owner things (issue #57). Emit points hand
 * notifications to `notificationService.notify`, which never blocks them:
 *
 * - Needs input: each approval or `ask_owner` call that starts waiting
 *   (`runtime.onWait`) pushes once, deduped per task so a re-run after a
 *   restart stays quiet; answering it before the coalescing window ends
 *   cancels the push, and one reminder follows if it is still waiting.
 * - Runs: a reply that ends in a model error, or one that ran for at least
 *   `longRunMinutes`, pushes when nobody has that chat open. Routine runs
 *   (their own conversations, issue #63) are left to the routine events.
 *   This is a step of the settled pipeline (`runNotificationsStep`).
 * - Routines: `notifyRoutineRun` (watcher and fire job). A blocked run
 *   (issue #87) stays quiet; the run that pauses the routine pushes once.
 */
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

/** The service surface emit points use (tests pass a fake). */
export type Notifier = Pick<
  typeof notificationService,
  "notify" | "cancel" | "getSettings" | "defineEvents"
>;

export type NotificationsRuntime = Pick<AgentRuntime, "onWait">;

export interface NotificationsWiring {
  stop(): void;
}

/**
 * The bot behind a chat conversation (titles and links). A routine's
 * conversation has none: its runs push through the routine events, and it
 * never waits on the owner (issue #63).
 */
async function botFor(conversation: number): Promise<BotRef | undefined> {
  const bot = await chatOwner(conversation);
  return bot ? { id: bot.id, name: bot.name, conversationId: conversation } : undefined;
}

export function startNotifications(
  runtime: NotificationsRuntime,
  notifier: Notifier = notificationService,
): NotificationsWiring {
  notifier.defineEvents(NOTIFICATION_EVENTS);
  // Vault values this process resolved never reach a push either.
  const offRedactor = registerRedactor((text) => secretRedactor.scrub(text));
  const reminders = new Map<string, ReturnType<typeof setTimeout>>();

  const send = (n: Notification) => notifier.notify(n);

  async function onAdded(event: WaitEvent): Promise<void> {
    const bot = await botFor(event.conversation);
    if (!bot) return;
    // A plain approval can be answered from the phone; takeovers and sign-ins need the app.
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
    // A request that expires first needs no reminder.
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

/**
 * The settled step: a failed or long reply reaches the owner's phone. The
 * reply is the Turn's last finished message; one from before this run (the
 * conversation settled without a new Turn) is not news. Only a bot's own
 * chat pushes here: a routine's conversation pushes through its routine
 * events, and a Past chat's is nobody's.
 */
export function runNotificationsStep(notifier: Notifier = notificationService): SettledStep {
  return {
    name: "run notifications",
    async run({ conversationId, chat, owner, startedAt }) {
      // A run that was already going at boot has no start: nothing to measure against.
      if (startedAt === undefined) return;
      const behind = await owner();
      if (behind?.kind !== "chat" || isBotWatched(behind.bot.id)) return;
      const bot: BotRef = { id: behind.bot.id, name: behind.bot.name, conversationId };
      const state = await chat();
      const last = state.messages.findLast((message) => message.role === "assistant");
      const reply = last ? finishedReplyOf(last) : undefined;
      if (!reply || reply.createdAt < startedAt) return;
      if (reply.error !== undefined) {
        notifier.notify(runFailed(bot, reply.createdAt, reply.error));
        return;
      }
      const { longRunMinutes } = await notifier.getSettings();
      const minutes = Math.floor((Date.now() - startedAt) / 60_000);
      if (minutes >= longRunMinutes) {
        notifier.notify(runLongDone(bot, reply.createdAt, minutes, reply.text));
      }
    },
  };
}

/** A routine run ended (watcher) or never started (fire job). */
export function notifyRoutineRun(
  run: RoutineRunRef,
  outcome: RoutineOutcome,
  notifier: Pick<Notifier, "notify"> = notificationService,
): void {
  if (outcome.status === "blocked") {
    if (outcome.pausedReason) notifier.notify(routinePausedBlocked(run, outcome.pausedReason));
    return;
  }
  notifier.notify(
    outcome.status === "succeeded"
      ? routineSucceeded(run, outcome.output)
      : routineFailed(run, outcome.status, outcome.error),
  );
}

/**
 * How a routine run ended, as its card and push see it. `blocked`: it
 * finished but could not do its job (issue #87); `pausedReason` is set on
 * the run that paused the routine.
 */
export type RoutineOutcome =
  | { status: "succeeded"; output?: string | null }
  | { status: "blocked"; error: string; pausedReason?: string | null }
  | { status: RoutineFailure; error?: string | null };

/** A vault security alert (reveal, delete, refused fill). Cannot be switched off. */
export function notifyVaultAlert(
  kind: EventVaultAlertKind,
  title: string,
  message: string,
  notifier: Pick<Notifier, "notify"> = notificationService,
): void {
  notifier.notify(vaultAlert(kind, title, message));
}
