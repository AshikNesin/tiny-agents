import { logger } from "@groot/core/logger";
import type { Notification } from "@groot/core/notification/notifier";
import { sanitizePeerText } from "@tiny-agents/agent";
import type { HarnessInstance, TurnOutcome } from "@tiny-agents/code/server";
import { threadKey } from "./code.threads";
import { relayText } from "../bots/bots.delivery";
import { codeUpdate } from "../notifications/notifications.events";
import type { HandoffFinish } from "./code.bots";
import type { CodeHub } from "./code.hub";
import { attentionNote, reportToProject } from "./code.report";
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

const RETRY_MS = 30_000;
const FINISH_MAX = 1_500;

export interface WatcherDeps {
  hub: CodeHub;
  deliver(finish: HandoffFinish): Promise<void>;
  notify(notification: Notification): void;
  retryMs?: number;
}

export function handoffFinishText(
  harness: string,
  handoff: Pick<ThreadHandoff, "threadId" | "title">,
  outcome: { text: string; failed: boolean; title?: string | null },
): string {
  const name = outcome.title || handoff.title || handoff.threadId;
  const head = outcome.failed
    ? `${harness} stopped with an error in **${name}**.`
    : `${harness} finished **${name}**.`;
  const text = sanitizePeerText(outcome.text);
  const clipped =
    text.length > FINISH_MAX
      ? `${text.slice(0, FINISH_MAX).trimEnd()}… (the rest is in the thread)`
      : text;
  const body = clipped ? `\n\n${clipped}` : "";
  return relayText(
    harness,
    `${head} [Open in Code](/code/t/${encodeURIComponent(handoff.threadId)})${body}`,
  );
}

function logError(error: unknown, threadId: string, what: string) {
  logger.warn({ error, threadId }, `Code watcher: ${what} failed`);
}

export function startCodeWatcher(deps: WatcherDeps): () => void {
  const { hub } = deps;

  const sending = new Set<string>();

  async function send(finishes: OwedFinish[]) {
    const batches = new Map<string, OwedFinish[]>();
    for (const finish of finishes) {
      if (sending.has(finish.id)) continue;
      const key = `${finish.botId}\n${finish.conversationId ?? ""}`;
      batches.set(key, [...(batches.get(key) ?? []), finish]);
    }
    for (const batch of batches.values()) {
      const first = batch[0]!;
      for (const finish of batch) sending.add(finish.id);
      try {
        await deps.deliver({
          botId: first.botId,
          conversationId: first.conversationId,
          requestId: batch.length === 1 ? first.requestId : `${first.requestId}+${batch.length}`,
          text: batch.map((finish) => finish.text).join("\n\n"),
          from: first.harness,
        });
        for (const finish of batch) await markFinishDelivered(finish.id);
      } catch (error) {
        logError(error, first.threadId ?? first.id, "finish delivery (will retry)");
      } finally {
        for (const finish of batch) sending.delete(finish.id);
      }
    }
  }

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
    if (owed.length > 0) await sweep();
  }

  async function onTurnEnd(instance: HarnessInstance, nativeId: string, outcome: TurnOutcome) {
    if (outcome.working) return;
    const id = threadKey(instance.id, nativeId);
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

  async function catchUp(instance: HarnessInstance, nativeId: string, handoffs: ThreadHandoff[]) {
    const outcome = await instance.outcome(nativeId);
    if (outcome.working) return;
    const ended = outcome.endedAt ?? 0;
    const due = handoffs.filter((h) => endsHandoff(h, ended));
    if (due.length > 0) await deliverFinished(instance, due, outcome);
  }

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

  async function onHandoff(threadId: string) {
    const target = hub.resolve(threadId);
    const handoffs = await runningHandoffs([threadId]);
    if (target && handoffs.length > 0) await catchUp(target.instance, target.nativeId, handoffs);
  }

  async function onAttention(
    instance: HarnessInstance,
    nativeId: string,
    text: string,
    key: string,
  ) {
    const id = threadKey(instance.id, nativeId);
    const threads = await hub.list().catch((error: unknown) => {
      logError(error, id, "reading the thread's title");
      return [];
    });
    const title = threads.find((t) => t.id === id)?.title ?? nativeId;
    await reportToProject(id, {
      key: `attention-${key}`,
      from: instance.label,
      text: attentionNote(title, text),
    });
    if (hub.viewers(id) > 0 || !(await isFollowed(id))) return;
    deps.notify(codeUpdate({ id, title, harness: instance.label }, "message", text, key));
  }

  const logSweep = (error: unknown) => logError(error, "*", "finish sweep");
  void sweep().catch(logSweep);
  const timer = setInterval(() => void sweep().catch(logSweep), deps.retryMs ?? RETRY_MS);
  timer.unref?.();

  const off = hub.onEvent(({ instance, event }) => {
    if (event.type === "turn_ended") {
      const id = threadKey(instance.id, event.nativeId);
      void onTurnEnd(instance, event.nativeId, event.outcome).catch((error: unknown) =>
        logError(error, id, "turn end"),
      );
    } else if (event.type === "connected") {
      void reconcile(instance)
        .catch((error: unknown) => logError(error, instance.id, "reconcile"))
        .then(sweep)
        .catch(logSweep);
    } else if (event.type === "attention") {
      const id = threadKey(instance.id, event.nativeId);
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
