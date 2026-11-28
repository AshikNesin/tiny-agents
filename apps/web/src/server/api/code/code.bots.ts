import { eq } from "drizzle-orm";
import type { CodeHandoffRecord, CodeStore } from "@tiny-agents/agent";
import { Boom } from "@groot/core/errors";
import { logger } from "@groot/core/logger";
import {
  HarnessError,
  type HarnessInstance,
  type ThreadSummary,
  type TurnOutcome,
} from "@tiny-agents/code/server";
import { threadKey, threadRef } from "./code.threads";
import {
  botMessages,
  codeProjects,
  codeThreads,
  db,
  type CodeHandoff,
  type CodeProjectRow,
} from "../../db";
import { submitToBot } from "../bots/bots.conversation";
import { createDeliveries, type DeliveryRuntime } from "../bots/bots.delivery";
import { conversationOwner, type ConversationBot } from "../bots/bots.owner";
import { codeHub } from "./code.hub";
import { listProjects, projectSettings, startProjectThread } from "./code.projects";
import { archiveCodeThread } from "./code.pulls";
import { startRun } from "./code.runs";
import {
  askedFrom,
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

const DEFAULT_HANDOFF_HARNESS = "shelley";

const codePath = (threadId: string) => `/code/t/${encodeURIComponent(threadId)}`;

function instances(): HarnessInstance[] {
  return codeHub()?.instances() ?? [];
}

function labelOf(threadId: string): string {
  const target = codeHub()?.resolve(threadId);
  if (target) return target.instance.label;
  return threadRef(threadId)?.instanceId ?? threadId;
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

async function ownerOf(conversationId: number): Promise<ConversationBot> {
  const owner = await conversationOwner(conversationId);
  if (!owner) throw Boom.notFound("No bot owns this conversation");
  return owner.bot;
}

async function botOf(conversationId: number): Promise<string> {
  return (await ownerOf(conversationId)).id;
}

const NO_PROJECT =
  "This chat's project was removed. Ask the owner to add the repository again under Code, Settings, Projects.";

async function chatProject(projectId: string): Promise<CodeProjectRow | undefined> {
  return db.query.codeProjects.findFirst({ where: eq(codeProjects.id, projectId) });
}

const THREADS_LISTED = 20;

function stateOf(status: ThreadSummary["status"]): string {
  const group = status ? GROUP_LABEL[status.group] : "unknown";
  return status?.reason ? `${group} (${status.reason})` : group;
}

const GROUP_LABEL: Record<NonNullable<ThreadSummary["status"]>["group"], string> = {
  "needs-you": "needs the owner",
  working: "working",
  review: "in review",
  done: "done",
};

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

const slugOf = (project: CodeProjectRow) => `${project.repoOwner}/${project.repoName}`;

async function pickProject(name?: string): Promise<CodeProjectRow | { error: string }> {
  const all = await listProjects();
  if (all.length === 0) {
    return {
      error:
        "There is no project to work in. Ask the owner to add the repository under Code, Settings, Projects.",
    };
  }
  const wanted = name?.trim().toLowerCase();
  if (!wanted) {
    if (all.length === 1) return all[0]!;
    return { error: `Say which project: ${all.map((p) => p.name).join(", ")}.` };
  }
  const found = all.find(
    (p) => p.name.toLowerCase() === wanted || slugOf(p).toLowerCase() === wanted,
  );
  return (
    found ?? { error: `No project "${name}". Projects: ${all.map((p) => p.name).join(", ")}.` }
  );
}

function harnessFor(project: CodeProjectRow, name?: string): HarnessInstance | { error: string } {
  if (name) return pickHarness(name);
  const preferred = instances().find((i) => i.id === project.defaultInstanceId);
  return preferred ?? pickHarness();
}

type StartInput = Parameters<CodeStore["start"]>[0];
type SendInput = Parameters<CodeStore["send"]>[0];

function claimedBefore(row: CodeHandoff): CodeHandoffRecord | { error: string } {
  if (row.threadId !== null) return toRecord({ ...row, threadId: row.threadId });
  return {
    error:
      "This start was interrupted by a restart before its thread was recorded, so it was not repeated (that could start the work twice). Tell the owner, and start it again only if they ask.",
  };
}

async function scopedProject(
  bot: ConversationBot,
  name?: string,
): Promise<CodeProjectRow | { error: string }> {
  if (!bot.projectId) return pickProject(name);
  const project = await chatProject(bot.projectId);
  if (!project) return { error: NO_PROJECT };
  const wanted = name?.trim().toLowerCase();
  if (wanted && wanted !== project.name.toLowerCase() && wanted !== slugOf(project).toLowerCase()) {
    return {
      error: `This chat works only in ${project.name}. Ask the owner to use that project's chat.`,
    };
  }
  return project;
}

async function startOnce(
  bot: ConversationBot,
  input: StartInput,
): Promise<CodeHandoffRecord | { error: string }> {
  const botId = bot.id;
  const existing = await findHandoffByKey(input.idempotencyKey);
  if (existing) return claimedBefore(existing);
  const project = await scopedProject(bot, input.project);
  if ("error" in project) return project;
  const instance = harnessFor(project, input.harness);
  if ("error" in instance) return instance;
  const caps = instance.capabilities();
  const claimed = await claimHandoff({
    botId,
    conversationId: String(input.conversationId),
    idempotencyKey: input.idempotencyKey,
    task: input.task,
    cwd: slugOf(project),
  });
  if (!claimed) return claimedBefore((await findHandoffByKey(input.idempotencyKey))!);
  let threadId: string;
  try {
    ({ threadId } = await startProjectThread(project, instance, {
      message: input.task,
      ...(input.model ? { model: input.model } : {}),
      ...(caps.settings.defaultPermissionMode
        ? { permissionMode: caps.settings.defaultPermissionMode }
        : {}),
    }));
  } catch (error) {
    await dropHandoffClaim(input.idempotencyKey);
    throw error;
  }
  await startRun(threadId, { trigger: "bot" });
  const row = await startedHandoff(input.idempotencyKey, threadId);
  const hub = codeHub();
  void hub?.refresh(instance.id);
  hub?.handedOff(row.threadId);
  return toRecord(row);
}

async function sendArmed(
  botId: string,
  target: { instance: HarnessInstance; nativeId: string },
  threadId: string,
  input: SendInput,
): Promise<{ status: "accepted" | "queued" } | { error: "not_found" }> {
  const handoff = await findHandoff(botId, threadId);
  const conversationId = String(input.conversationId);
  let undo: (() => Promise<unknown>) | undefined;
  let adopted = false;
  if (!handoff) {
    const found = await outcomeOf(threadId);
    if (!found) return { error: "not_found" };
    const row = await recordHandoff({
      botId,
      conversationId,
      idempotencyKey: input.idempotencyKey,
      task: input.message,
      ...(found.outcome.cwd ? { cwd: found.outcome.cwd } : {}),
      threadId,
      title: found.outcome.title,
    });
    undo = () => forgetHandoff(row.id);
    adopted = true;
  } else {
    const before = await askedFrom(handoff.id, conversationId);
    const restore = async () => {
      if (before !== null) await askedFrom(handoff.id, before);
    };
    if (handoff.status === "finished") {
      await reopenHandoff(handoff.id);
      undo = async () => {
        await finishHandoffOnce(handoff.id);
        await restore();
      };
    } else {
      undo = restore;
    }
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

  async projects() {
    return (await listProjects()).map((p) => ({ name: p.name, repo: slugOf(p) }));
  },

  async start(input) {
    const bot = await ownerOf(input.conversationId);
    const work = () => startOnce(bot, input);
    return codeHub()?.serial(`start:${input.idempotencyKey}`, work) ?? work();
  },

  async send(input) {
    const botId = await botOf(input.conversationId);
    const hub = codeHub();
    const target = hub?.resolve(input.threadId);
    if (!hub || !target) return { error: "not_found" };
    const threadId = threadKey(target.instance.id, target.nativeId);
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
        .catch((error: unknown) => {
          logger.warn({ error, threadId: input.threadId }, "Code: could not list a thread's diff");
          return undefined;
        });
    }
    return {
      harness: instance.label,
      working: outcome.working,
      title: outcome.title,
      text: outcome.text,
      failed: outcome.failed,
      ...(changedFiles ? { changedFiles } : {}),
      url: codePath(threadKey(instance.id, nativeId)),
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

  async scope(conversationId) {
    const bot = await ownerOf(conversationId);
    const project = bot.projectId ? await chatProject(bot.projectId) : undefined;
    if (!project) return undefined;
    return {
      name: project.name,
      repo: slugOf(project),
      baseBranch: project.baseBranch,
      instructions: projectSettings(project.settings).instructions,
    };
  },

  async threads(conversationId) {
    const bot = await ownerOf(conversationId);
    const hub = codeHub();
    if (!bot.projectId || !hub) return [];
    return (await hub.list())
      .filter((thread) => thread.projectId === bot.projectId && thread.role !== "review")
      .slice(0, THREADS_LISTED)
      .map((thread) => ({
        threadId: thread.id,
        title: thread.title,
        state: stateOf(thread.status),
        branch: thread.branch ?? null,
        pr: thread.pr?.number ?? null,
        url: codePath(thread.id),
      }));
  },

  async resolve(input) {
    const bot = await ownerOf(input.conversationId);
    const target = codeHub()?.resolve(input.threadId);
    if (!target) return { error: `There is no thread ${input.threadId}. Use code_list.` };
    const threadId = threadKey(target.instance.id, target.nativeId);
    const row = await db.query.codeThreads.findFirst({ where: eq(codeThreads.id, threadId) });
    if (!bot.projectId || row?.projectId !== bot.projectId) {
      return { error: "Only this project's threads can be resolved here." };
    }
    await archiveCodeThread(threadId, true);
    return {};
  },
};

export interface HandoffFinish {
  botId: string;
  conversationId: string | null;
  requestId: string;
  text: string;
  from: string;
}

export async function deliverHandoffFinish(
  rt: DeliveryRuntime,
  finish: HandoffFinish,
): Promise<void> {
  const peer = { kind: "reply" as const, name: finish.from };
  const submission = { requestId: finish.requestId, text: finish.text, peer };
  const conversationId = finish.conversationId;
  const owner = conversationId ? await conversationOwner(conversationId) : undefined;
  if (conversationId && owner?.kind === "routine" && owner.bot.id === finish.botId) {
    await submitToBot(finish.botId, submission, rt, {
      unattendedConversationId: conversationId,
      unattended: "routine",
    });
    return;
  }
  if (conversationId && owner?.kind === "delivery" && owner.bot.id === finish.botId) {
    const asked = await db.query.botMessages.findFirst({
      where: eq(botMessages.id, owner.deliveryId),
      columns: { replyToBotId: true },
    });
    await createDeliveries(rt).deliver({
      requestId: finish.requestId,
      kind: "send",
      toBotId: finish.botId,
      fromBotId: null,
      replyToBotId: asked?.replyToBotId ?? null,
      conversationId,
      text: finish.text,
      prompt: finish.text,
      peer,
    });
    return;
  }
  await submitToBot(finish.botId, submission, rt);
}
