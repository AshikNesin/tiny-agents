/**
 * Turn ends, acted on, for every harness (issue #143, ADR 0011):
 *
 * - A **hand-off** (a bot started the thread with `code_start` or
 *   `shelley_start`) gets the finish delivered, once, as a reply from the
 *   harness, into the conversation that asked (its chat, a routine run's or
 *   a bot message's). The harness's words are untrusted peer text.
 *   The finish is recorded as owed with the hand-off's running → finished
 *   move, then submitted (idempotent by request id) and marked delivered; a
 *   finish still owed after a crash or a failed submit is sent again at
 *   boot, on every reconnect and on a timer until it lands (register C7).
 * - A **followed** thread (started, opened or handed off here) pushes a
 *   notification when it finishes, fails or asks for the owner while no tab
 *   shows it.
 *
 * Nothing polls: instances report working → idle with the turn's outcome
 * (the one turn-outcome rule, `@tiny-agents/code/server`), and on every
 * (re)connect the running hand-offs of that instance are reconciled, so a
 * finish missed while a harness was unreachable is still delivered once. The
 * watcher only reads outcomes; it never re-derives the text or the failure.
 */
import { logger } from "@groot/core/logger";
import type { Notification } from "@groot/core/notification/notifier";
import { sanitizePeerText } from "@tiny-agents/agent";
import { threadIdOf, type HarnessInstance, type TurnOutcome } from "@tiny-agents/code/server";
import { relayText } from "../bots/bots.delivery";
import { codeUpdate } from "../notifications/notifications.events";
import type { HandoffFinish } from "./code.bots";
import type { CodeHub } from "./code.hub";
import {
  endsHandoff,
  isFollowed,
  markFinishDelivered,
  oweFinish,
  owedFinishes,
  runningHandoffs,
  type OwedFinish,
  type ThreadHandoff,
} from "./code.store";

/** How often finishes still owed are sent again. */
const RETRY_MS = 30_000;

export interface WatcherDeps {
  hub: CodeHub;
  /** Put a finish in front of the bot that asked (`deliverHandoffFinish`, idempotent by requestId). */
  deliver(finish: HandoffFinish): Promise<void>;
  notify(notification: Notification): void;
  /** How often finishes still owed are sent again (default 30 s). */
  retryMs?: number;
}

/** The chat text a bot receives when its hand-off's turn ends (`text` is already chat-sized). */
export function handoffFinishText(
  harness: string,
  handoff: Pick<ThreadHandoff, "threadId" | "title">,
  outcome: { text: string; failed: boolean; title?: string | null },
): string {
  const name = outcome.title || handoff.title || handoff.threadId;
  const head = outcome.failed
    ? `${harness} stopped with an error in **${name}**.`
    : `${harness} finished **${name}**.`;
  const body = outcome.text ? `\n\n${sanitizePeerText(outcome.text)}` : "";
  return relayText(
    harness,
    `${head} [Open in Code](/code/${encodeURIComponent(handoff.threadId)})${body}`,
  );
}

function logError(error: unknown, threadId: string, what: string) {
  logger.warn({ error, threadId }, `Code watcher: ${what} failed`);
}

export function startCodeWatcher(deps: WatcherDeps): () => void {
  const { hub } = deps;

  /** Owed finishes being submitted now, so a sweep and a turn end never send one twice at once. */
  const sending = new Set<string>();

  /** Submit owed finishes; one that fails stays owed for the next sweep. */
  async function send(finishes: OwedFinish[]) {
    for (const finish of finishes) {
      if (sending.has(finish.id)) continue;
      sending.add(finish.id);
      try {
        await deps.deliver({
          botId: finish.botId,
          conversationId: finish.conversationId,
          requestId: finish.requestId,
          text: finish.text,
          from: finish.harness,
        });
        await markFinishDelivered(finish.id);
      } catch (error) {
        logError(error, finish.threadId ?? finish.id, "finish delivery (will retry)");
      } finally {
        sending.delete(finish.id);
      }
    }
  }

  /** Every finish still owed (boot, reconnects, the retry timer). */
  async function sweep() {
    await send(await owedFinishes());
  }

  async function deliverFinished(
    instance: HarnessInstance,
    handoffs: ThreadHandoff[],
    outcome: TurnOutcome,
  ) {
    const owed: OwedFinish[] = [];
    for (const handoff of handoffs) {
      const finish = oweFinish(handoff, {
        requestId: `code-${handoff.id}-${outcome.cursor}`,
        harness: instance.label,
        text: handoffFinishText(instance.label, handoff, outcome),
      });
      if (finish) owed.push(finish);
    }
    await send(owed);
  }

  async function onTurnEnd(instance: HarnessInstance, nativeId: string, outcome: TurnOutcome) {
    // A queued message started the next turn already: wait for that one.
    if (outcome.working) return;
    const id = threadIdOf(instance.id, nativeId);
    const [handoffs, followed] = await Promise.all([runningHandoffs([id]), isFollowed(id)]);
    if (handoffs.length === 0 && !followed) return;
    await deliverFinished(instance, handoffs, outcome);
    if (followed && hub.viewers(id) === 0) {
      deps.notify(
        codeUpdate(
          { id, title: outcome.title, harness: instance.label },
          outcome.failed ? "failed" : "finished",
          outcome.text,
          outcome.endedAt ?? outcome.cursor,
        ),
      );
    }
  }

  /** Owe the finish of a turn that ended while nothing was listening for it. */
  async function catchUp(instance: HarnessInstance, nativeId: string, handoffs: ThreadHandoff[]) {
    const outcome = await instance.outcome(nativeId);
    if (outcome.working) return;
    const ended = outcome.endedAt ?? 0;
    const due = handoffs.filter((h) => endsHandoff(h, ended));
    if (due.length > 0) await deliverFinished(instance, due, outcome);
  }

  /** Hand-offs of this instance whose turn ended while it was unreachable. */
  async function reconcile(instance: HarnessInstance) {
    const byThread = new Map<string, { nativeId: string; handoffs: ThreadHandoff[] }>();
    for (const h of await runningHandoffs()) {
      const target = hub.resolve(h.threadId);
      if (target?.instance.id !== instance.id) continue;
      const entry = byThread.get(h.threadId) ?? { nativeId: target.nativeId, handoffs: [] };
      entry.handoffs.push(h);
      byThread.set(h.threadId, entry);
    }
    for (const [threadId, { nativeId, handoffs }] of byThread) {
      try {
        await catchUp(instance, nativeId, handoffs);
      } catch (error) {
        logError(error, threadId, "reconcile");
      }
    }
  }

  /** A start recorded its thread: its turn may have ended before the row was running. */
  async function onHandoff(threadId: string) {
    const target = hub.resolve(threadId);
    const handoffs = await runningHandoffs([threadId]);
    if (target && handoffs.length > 0) await catchUp(target.instance, target.nativeId, handoffs);
  }

  /** The harness wants the owner mid-turn (Shelley's message_user, a Claude approval). */
  async function onAttention(
    instance: HarnessInstance,
    nativeId: string,
    text: string,
    key: string,
  ) {
    const id = threadIdOf(instance.id, nativeId);
    if (hub.viewers(id) > 0 || !(await isFollowed(id))) return;
    const title = (await hub.list().catch(() => [])).find((t) => t.id === id)?.title ?? nativeId;
    deps.notify(codeUpdate({ id, title, harness: instance.label }, "message", text, key));
  }

  const logSweep = (error: unknown) => logError(error, "*", "finish sweep");
  // Finishes owed when the app stopped.
  void sweep().catch(logSweep);
  const timer = setInterval(() => void sweep().catch(logSweep), deps.retryMs ?? RETRY_MS);
  timer.unref?.();

  const off = hub.onEvent(({ instance, event }) => {
    if (event.type === "turn_ended") {
      const id = threadIdOf(instance.id, event.nativeId);
      void onTurnEnd(instance, event.nativeId, event.outcome).catch((error: unknown) =>
        logError(error, id, "turn end"),
      );
    } else if (event.type === "connected") {
      void reconcile(instance)
        .catch((error: unknown) => logError(error, instance.id, "reconcile"))
        .then(sweep)
        .catch(logSweep);
    } else if (event.type === "attention") {
      const id = threadIdOf(instance.id, event.nativeId);
      void onAttention(instance, event.nativeId, event.text, event.key).catch((error: unknown) =>
        logError(error, id, "attention"),
      );
    }
  });
  const offHandoff = hub.onHandoff((threadId) => {
    void onHandoff(threadId).catch((error: unknown) => logError(error, threadId, "start catch-up"));
  });
  return () => {
    off();
    offHandoff();
    clearInterval(timer);
  };
}
