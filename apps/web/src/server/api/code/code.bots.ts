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
  findHandoff,
  findHandoffByKey,
  follow,
  listHandoffs,
  recordHandoff,
  reopenHandoff,
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

function toRecord(row: CodeHandoff): CodeHandoffRecord {
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
    // A replayed call (pi-durable re-ran the tool task) returns the first start.
    const existing = await findHandoffByKey(input.idempotencyKey);
    if (existing) return toRecord(existing);
    const instance = pickHarness(input.harness);
    if ("error" in instance) return instance;
    const caps = instance.capabilities();
    if (caps.workspace.requiresCwd && !input.cwd) {
      return { error: `${instance.label} needs a working directory: pass cwd (the repo's path).` };
    }
    const { nativeId } = await instance.createThread({
      message: input.task,
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(input.model ? { model: input.model } : {}),
      // Hand-offs edit without asking, like owner-started threads (issue #157).
      ...(caps.settings.defaultPermissionMode
        ? { permissionMode: caps.settings.defaultPermissionMode }
        : {}),
    });
    const threadId = threadIdOf(instance.id, nativeId);
    const row = await recordHandoff({
      botId,
      idempotencyKey: input.idempotencyKey,
      task: input.task,
      cwd: input.cwd,
      threadId,
    });
    await follow(instance.id, nativeId);
    void codeHub()?.refresh(instance.id);
    return toRecord(row);
  },

  async send(input) {
    const botId = await botOf(input.conversationId);
    const target = codeHub()?.resolve(input.threadId);
    if (!target) return { error: "not_found" };
    const threadId = threadIdOf(target.instance.id, target.nativeId);
    let handoff = await findHandoff(botId, threadId);
    // An existing thread (started earlier, in the harness or on the Code
    // page): check the harness has it, then adopt it so its finish comes back.
    let adopt: TurnOutcome | undefined;
    if (!handoff) {
      const found = await outcomeOf(threadId);
      if (!found) return { error: "not_found" };
      adopt = found.outcome;
    }
    let result: { status: "accepted" | "queued" };
    try {
      result = await target.instance.send(target.nativeId, {
        message: input.message,
        ...(input.queue ? { queue: true } : {}),
      });
    } catch (error) {
      if (error instanceof HarnessError && error.status === 404) return { error: "not_found" };
      throw error;
    }
    if (adopt) {
      handoff = await recordHandoff({
        botId,
        idempotencyKey: input.idempotencyKey,
        task: input.message,
        ...(adopt.cwd ? { cwd: adopt.cwd } : {}),
        threadId,
        title: adopt.title,
      });
      await follow(target.instance.id, target.nativeId);
    } else if (handoff?.status === "finished") {
      // The follow-up's turn ends with a finish the bot should hear about too.
      await reopenHandoff(handoff.id);
    }
    return result;
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
