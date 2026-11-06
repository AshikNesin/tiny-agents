/**
 * Turn ends, acted on, for every harness (issue #143, ADR 0011):
 *
 * - A **hand-off** (a bot started the thread with `code_start` or
 *   `shelley_start`) gets the finish delivered into the bot's chat, once, as
 *   a reply from the harness. The harness's words are untrusted peer text.
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
import type { CodeHandoff } from "../../db";
import { relayText } from "../bots/bots.delivery";
import { codeUpdate } from "../notifications/notifications.events";
import type { CodeHub } from "./code.hub";
import { finishHandoffOnce, isFollowed, runningHandoffs } from "./code.store";

export interface WatcherDeps {
  hub: CodeHub;
  /** Submit a message into a bot's current chat as a reply from `from` (idempotent by requestId). */
  deliver(
    botId: string,
    submission: { requestId: string; text: string; from: string },
  ): Promise<void>;
  notify(notification: Notification): void;
}

/** The chat text a bot receives when its hand-off's turn ends (`text` is already chat-sized). */
export function handoffFinishText(
  harness: string,
  handoff: Pick<CodeHandoff, "threadId" | "title">,
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

  async function deliverFinished(
    instance: HarnessInstance,
    handoffs: CodeHandoff[],
    outcome: TurnOutcome,
  ) {
    for (const handoff of handoffs) {
      if (!(await finishHandoffOnce(handoff.id))) continue;
      await deps.deliver(handoff.botId, {
        requestId: `code-${handoff.id}-${outcome.cursor}`,
        text: handoffFinishText(instance.label, handoff, outcome),
        from: instance.label,
      });
    }
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

  /** Hand-offs of this instance whose turn ended while it was unreachable. */
  async function reconcile(instance: HarnessInstance) {
    const byThread = new Map<string, { nativeId: string; handoffs: CodeHandoff[] }>();
    for (const h of await runningHandoffs()) {
      const target = hub.resolve(h.threadId);
      if (target?.instance.id !== instance.id) continue;
      const entry = byThread.get(h.threadId) ?? { nativeId: target.nativeId, handoffs: [] };
      entry.handoffs.push(h);
      byThread.set(h.threadId, entry);
    }
    for (const [threadId, { nativeId, handoffs }] of byThread) {
      try {
        const outcome = await instance.outcome(nativeId);
        if (outcome.working) continue;
        // Only a turn that ended after the hand-off started counts.
        const ended = outcome.endedAt ?? 0;
        const due = handoffs.filter((h) => ended >= h.createdAt.getTime());
        if (due.length > 0) await deliverFinished(instance, due, outcome);
      } catch (error) {
        logError(error, threadId, "reconcile");
      }
    }
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

  return hub.onEvent(({ instance, event }) => {
    if (event.type === "turn_ended") {
      const id = threadIdOf(instance.id, event.nativeId);
      void onTurnEnd(instance, event.nativeId, event.outcome).catch((error: unknown) =>
        logError(error, id, "turn end"),
      );
    } else if (event.type === "connected") {
      void reconcile(instance).catch((error: unknown) => logError(error, instance.id, "reconcile"));
    } else if (event.type === "attention") {
      const id = threadIdOf(instance.id, event.nativeId);
      void onAttention(instance, event.nativeId, event.text, event.key).catch((error: unknown) =>
        logError(error, id, "attention"),
      );
    }
  });
}
