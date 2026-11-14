/**
 * The `CodeStore` the bots' code tools run against (packages/agent
 * toolkits/code.ts): start and steer threads in any configured harness and
 * record hand-offs, always scoped to the bot that owns the asking
 * conversation (its chat or one of its routines). Shelley is the default
 * harness for hand-offs (owner decision, issue #157).
 */
import type { CodeHandoffRecord, CodeStore } from "@tiny-agents/agent";
import { Boom } from "@groot/core/errors";
import {
  HarnessError,
  LEGACY_INSTANCE_ID,
  parseThreadId,
  threadIdOf,
  type HarnessInstance,
  type TurnOutcome,
} from "@tiny-agents/code/server";
import type { CodeHandoff } from "../../db";
import { conversationOwner } from "../bots/bots.owner";
import { codeHub } from "./code.hub";
import {
  claimHandoff,
  dropHandoffClaim,
  findHandoff,
  findHandoffByKey,
  finishHandoffOnce,
  follow,
  forgetHandoff,
  listHandoffs,
  recordHandoff,
  reopenHandoff,
  startedHandoff,
  type ThreadHandoff,
} from "./code.store";

/** The harness bots hand work to when they name none. */
const DEFAULT_HANDOFF_HARNESS = "shelley";

const codePath = (threadId: string) => `/code/${encodeURIComponent(threadId)}`;

function instances(): HarnessInstance[] {
  return codeHub()?.instances() ?? [];
}

function labelOf(threadId: string): string {
  const target = codeHub()?.resolve(threadId);
  if (target) return target.instance.label;
  return parseThreadId(threadId, LEGACY_INSTANCE_ID)?.instanceId ?? threadId;
}

function toRecord(row: ThreadHandoff): CodeHandoffRecord {
  return {
    threadId: row.threadId,
    harness: labelOf(row.threadId),
    title: row.title,
    task: row.task,
    cwd: row.cwd,
    status: row.status === "finished" ? "finished" : "running",
    url: codePath(row.threadId),
    createdAt: row.createdAt.toISOString(),
  };
}

async function botOf(conversationId: number): Promise<string> {
  const owner = await conversationOwner(conversationId);
  if (!owner) throw Boom.notFound("No bot owns this conversation");
  return owner.bot.id;
}

/** The named harness, else the default, else the only one. */
function pickHarness(name?: string): HarnessInstance | { error: string } {
  const all = instances();
  const available = all.map((i) => i.id).join(", ") || "none";
  if (name) {
    const found = all.find((i) => i.id === name);
    return found ?? { error: `No harness "${name}". Available: ${available}.` };
  }
  const fallback = all.find((i) => i.id === DEFAULT_HANDOFF_HARNESS) ?? all[0];
  return fallback ?? { error: "No coding agent is configured." };
}

async function outcomeOf(threadId: string): Promise<{
  instance: HarnessInstance;
  nativeId: string;
  outcome: TurnOutcome;
} | null> {
  const target = codeHub()?.resolve(threadId);
  if (!target) return null;
  try {
    return { ...target, outcome: await target.instance.outcome(target.nativeId) };
  } catch (error) {
    if (error instanceof HarnessError && error.status === 404) return null;
    throw error;
  }
}

type StartInput = Parameters<CodeStore["start"]>[0];
type SendInput = Parameters<CodeStore["send"]>[0];

/** What a start whose key was already claimed returns: its hand-off, if it got a thread. */
function claimedBefore(row: CodeHandoff): CodeHandoffRecord | { error: string } {
  if (row.threadId !== null) return toRecord({ ...row, threadId: row.threadId });
  return {
    error:
      "This start was interrupted by a restart before its thread was recorded, so it was not repeated (that could start the work twice). Tell the owner, and start it again only if they ask.",
  };
}

/**
 * Start a hand-off once per idempotency key: the row is claimed before the
 * harness makes the thread, so a replay never makes a second one. A claim
 * left `starting` by a run that died before recording its thread is not
 * repeated: the harness may have made the thread already.
 */
async function startOnce(
  botId: string,
  input: StartInput,
): Promise<CodeHandoffRecord | { error: string }> {
  const existing = await findHandoffByKey(input.idempotencyKey);
  if (existing) return claimedBefore(existing);
  const instance = pickHarness(input.harness);
  if ("error" in instance) return instance;
  const caps = instance.capabilities();
  if (caps.workspace.requiresCwd && !input.cwd) {
    return { error: `${instance.label} needs a working directory: pass cwd (the repo's path).` };
  }
  const claimed = await claimHandoff({
    botId,
    idempotencyKey: input.idempotencyKey,
    task: input.task,
    cwd: input.cwd,
  });
  if (!claimed) return claimedBefore((await findHandoffByKey(input.idempotencyKey))!);
  let nativeId: string;
  try {
    ({ nativeId } = await instance.createThread({
      message: input.task,
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(input.model ? { model: input.model } : {}),
      // Hand-offs edit without asking, like owner-started threads (issue #157).
      ...(caps.settings.defaultPermissionMode
        ? { permissionMode: caps.settings.defaultPermissionMode }
        : {}),
    }));
  } catch (error) {
    // The harness made nothing: the call may be tried again.
    await dropHandoffClaim(input.idempotencyKey);
    throw error;
  }
  const row = await startedHandoff(input.idempotencyKey, threadIdOf(instance.id, nativeId));
  await follow(instance.id, nativeId);
  void codeHub()?.refresh(instance.id);
  return toRecord(row);
}

/**
 * Send on a thread with its hand-off armed first: adopt a thread this bot
 * has no hand-off for, or reopen a finished one. If the harness refuses the
 * message, the hand-off goes back to how it was.
 */
async function sendArmed(
  botId: string,
  target: { instance: HarnessInstance; nativeId: string },
  threadId: string,
  input: SendInput,
): Promise<{ status: "accepted" | "queued" } | { error: "not_found" }> {
  const handoff = await findHandoff(botId, threadId);
  let undo: (() => Promise<unknown>) | undefined;
  let adopted = false;
  if (!handoff) {
    // An existing thread (started earlier, in the harness or on the Code
    // page): check the harness has it, then adopt it so its finish comes back.
    const found = await outcomeOf(threadId);
    if (!found) return { error: "not_found" };
    const row = await recordHandoff({
      botId,
      idempotencyKey: input.idempotencyKey,
      task: input.message,
      ...(found.outcome.cwd ? { cwd: found.outcome.cwd } : {}),
      threadId,
      title: found.outcome.title,
    });
    undo = () => forgetHandoff(row.id);
    adopted = true;
  } else if (handoff.status === "finished") {
    // The follow-up's turn ends with a finish the bot should hear about too.
    await reopenHandoff(handoff.id);
    undo = () => finishHandoffOnce(handoff.id);
  }
  let result: { status: "accepted" | "queued" };
  try {
    result = await target.instance.send(target.nativeId, {
      message: input.message,
      ...(input.queue ? { queue: true } : {}),
    });
  } catch (error) {
    await undo?.();
    if (error instanceof HarnessError && error.status === 404) return { error: "not_found" };
    throw error;
  }
  if (adopted) await follow(target.instance.id, target.nativeId);
  return result;
}

export const codeStore: CodeStore = {
  async harnesses() {
    const fallback = pickHarness();
    return instances().map((i) => ({
      id: i.id,
      label: i.label,
      isDefault: "id" in fallback && fallback.id === i.id,
    }));
  },

  async start(input) {
    const botId = await botOf(input.conversationId);
    const work = () => startOnce(botId, input);
    // A replayed call (pi-durable re-ran the tool task) waits for the first
    // run in this process, then returns what it started.
    return codeHub()?.serial(`start:${input.idempotencyKey}`, work) ?? work();
  },

  async send(input) {
    const botId = await botOf(input.conversationId);
    const hub = codeHub();
    const target = hub?.resolve(input.threadId);
    if (!hub || !target) return { error: "not_found" };
    const threadId = threadIdOf(target.instance.id, target.nativeId);
    // One send at a time per thread, each arming the hand-off before the
    // harness hears the message: a turn that ends at once still finds it running.
    return hub.serial(`send:${threadId}`, () => sendArmed(botId, target, threadId, input));
  },

  async status(input) {
    await botOf(input.conversationId);
    const found = await outcomeOf(input.threadId);
    if (!found) return undefined;
    const { instance, nativeId, outcome } = found;
    let changedFiles;
    if (outcome.cwd && instance.diffFiles) {
      changedFiles = await instance
        .diffFiles(outcome.cwd, "working")
        .then((files) =>
          files.map((f) => ({
            path: f.path,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
          })),
        )
        .catch(() => undefined);
    }
    return {
      harness: instance.label,
      working: outcome.working,
      title: outcome.title,
      text: outcome.text,
      failed: outcome.failed,
      ...(changedFiles ? { changedFiles } : {}),
      url: codePath(threadIdOf(instance.id, nativeId)),
    };
  },

  async models(harness) {
    const instance = pickHarness(harness);
    if ("error" in instance) return instance;
    return (await instance.models())
      .filter((m) => m.ready !== false)
      .map((m) => ({
        id: m.id,
        ...(m.label && m.label !== m.id ? { name: m.label } : {}),
        isDefault: Boolean(m.isDefault),
      }))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  },

  async list(conversationId) {
    return (await listHandoffs(await botOf(conversationId))).map(toRecord);
  },
};
