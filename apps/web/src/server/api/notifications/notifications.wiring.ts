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
 * - Routines: `notifyRoutineRun` (watcher and fire job). A blocked run
 *   (issue #87) stays quiet; the run that pauses the routine pushes once.
 */
import { eq } from "drizzle-orm";
import { logger } from "@groot/core/logger";
import type { Notification } from "@groot/core/notification/notifier";
import { notificationService } from "@groot/core/notification/notification.service";
import { registerRedactor } from "@groot/core/notification/scrub";
import { secretRedactor, type AgentRuntime, type WaitEvent } from "@tiny-agents/agent";
import { bots, db } from "../../db";
import { isBotWatched } from "../bots/bots.viewers";
import { conversationOwner } from "../bots/bots.owner";
import {
  approvalRequested,
  credentialRequested,
  inputReminder,
  NOTIFICATION_EVENTS,
  questionAsked,
  routineFailed,
  routinePausedBlocked,
  routineSucceeded,
  runFailed,
  runLongDone,
  waitKey,
  type BotRef,
  type RoutineFailure,
  type RoutineRunRef,
  type VaultAlertKind,
  vaultAlert,
} from "./notifications.events";

/** The service surface emit points use (tests pass a fake). */
export type Notifier = Pick<
  typeof notificationService,
  "notify" | "cancel" | "getSettings" | "defineEvents"
>;

export type NotificationsRuntime = Pick<AgentRuntime, "onWait" | "onActivity" | "finishedReplies">;

export interface NotificationsWiring {
  stop(): void;
}

const BOT_CACHE_MS = 60_000;

/**
 * The bot behind a chat conversation, cached briefly (titles and links).
 * A routine's conversation has none: its runs push through the routine
 * events, and it never waits on the owner (issue #63).
 */
function createBotLookup() {
  const cache = new Map<number, { bot: BotRef | undefined; at: number }>();
  return async (conversation: number): Promise<BotRef | undefined> => {
    const hit = cache.get(conversation);
    if (hit && Date.now() - hit.at < BOT_CACHE_MS) return hit.bot;
    const owner = await conversationOwner(conversation);
    const row =
      owner && owner.routineId === undefined
        ? await db.query.bots.findFirst({
            where: eq(bots.id, owner.botId),
            columns: { id: true, name: true },
          })
        : undefined;
    const bot = row ? { ...row, conversationId: conversation } : undefined;
    cache.set(conversation, { bot, at: Date.now() });
    return bot;
  };
}

export function startNotifications(
  runtime: NotificationsRuntime,
  notifier: Notifier = notificationService,
): NotificationsWiring {
  notifier.defineEvents(NOTIFICATION_EVENTS);
  // Vault values this process resolved never reach a push either.
  const offRedactor = registerRedactor((text) => secretRedactor.scrub(text));
  const botFor = createBotLookup();
  const reminders = new Map<string, ReturnType<typeof setTimeout>>();
  const runStarts = new Map<number, number>();

  const send = (n: Notification) => notifier.notify(n);

  async function onAdded(event: WaitEvent): Promise<void> {
    const bot = await botFor(event.conversation);
    if (!bot) return;
    send(
      event.kind === "question"
        ? questionAsked(bot, event.task, event.preview)
        : event.tool === "request_credentials"
          ? credentialRequested(bot, event.task, event.subject, event.expiresAt)
          : approvalRequested(bot, event.task, event.tool ?? "a tool", event),
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
      send(inputReminder(bot, event.kind, event.task, reminderMinutes));
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

  async function onIdle(conversation: number, startedAt: number): Promise<void> {
    const bot = await botFor(conversation);
    if (!bot || isBotWatched(bot.id)) return;
    const replies = await runtime.finishedReplies(conversation);
    const last = replies.at(-1);
    if (!last || last.createdAt < startedAt) return;
    if (last.error !== undefined) {
      send(runFailed(bot, last.createdAt, last.error));
      return;
    }
    const { longRunMinutes } = await notifier.getSettings();
    const minutes = Math.floor((Date.now() - startedAt) / 60_000);
    if (minutes >= longRunMinutes) send(runLongDone(bot, last.createdAt, minutes, last.text));
  }

  const offActivity = runtime.onActivity((change) => {
    const conversation = Number(change.conversation);
    if (change.busy) {
      if (!runStarts.has(conversation)) runStarts.set(conversation, Date.now());
      return;
    }
    const startedAt = runStarts.get(conversation);
    runStarts.delete(conversation);
    if (startedAt === undefined) return;
    void onIdle(conversation, startedAt).catch((error: unknown) =>
      logger.warn({ error }, "Run notification failed"),
    );
  });

  return {
    stop() {
      offRedactor();
      offWait();
      offActivity();
      for (const timer of reminders.values()) clearTimeout(timer);
      reminders.clear();
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
  kind: VaultAlertKind,
  title: string,
  message: string,
  notifier: Pick<Notifier, "notify"> = notificationService,
): void {
  notifier.notify(vaultAlert(kind, title, message));
}
