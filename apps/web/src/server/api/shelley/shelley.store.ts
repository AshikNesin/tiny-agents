/**
 * ShelleyStore adapter (issue #143): what the agent's `shelley_*` tools
 * (packages/agent/src/toolkits/shelley.ts) run against. It starts and steers
 * Shelley conversations through Shelley's API and records hand-offs, always
 * scoped to the bot that owns the asking conversation (its chat or one of
 * its routines).
 */
import type { ShelleyChangedFile, ShelleyHandoffRecord, ShelleyStore } from "@tiny-agents/agent";
import { Boom } from "@groot/core/errors";
import type { ShelleyHandoff } from "../../db";
import { conversationOwner } from "../bots/bots.owner";
import { shelleyJson } from "./shelley.client";
import { shelleyHub } from "./shelley.hub";
import {
  findHandoff,
  findHandoffByKey,
  listHandoffs,
  readTurnOutcome,
  recordHandoff,
  reopenHandoff,
} from "./shelley.service";

const codePath = (id: string) => `/code/${id}`;

function toRecord(row: ShelleyHandoff): ShelleyHandoffRecord {
  return {
    conversationId: row.shelleyConversationId,
    slug: row.slug,
    task: row.task,
    cwd: row.cwd,
    status: row.status === "finished" ? "finished" : "running",
    url: codePath(row.shelleyConversationId),
    createdAt: row.createdAt.toISOString(),
  };
}

async function botOf(conversationId: number): Promise<string> {
  const owner = await conversationOwner(conversationId);
  if (!owner) throw Boom.notFound("No bot owns this conversation");
  return owner.bot.id;
}

export const shelleyStore: ShelleyStore = {
  async start(input) {
    const botId = await botOf(input.conversationId);
    // A replayed call (pi-durable re-ran the tool task) returns the first start.
    const existing = await findHandoffByKey(input.idempotencyKey);
    if (existing) return toRecord(existing);
    const created = await shelleyJson<{ conversation_id?: string }>("/conversations/new", {
      method: "POST",
      json: {
        message: input.task,
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(input.model ? { model: input.model } : {}),
      },
    });
    if (!created.conversation_id) throw Boom.badGateway("Shelley did not return a conversation id");
    const row = await recordHandoff({
      botId,
      idempotencyKey: input.idempotencyKey,
      task: input.task,
      cwd: input.cwd,
      shelleyConversationId: created.conversation_id,
    });
    void shelleyHub()?.refreshList();
    return toRecord(row);
  },

  async send(input) {
    const botId = await botOf(input.conversationId);
    const handoff = await findHandoff(botId, input.shelleyConversationId);
    if (!handoff) return { error: "not_found" };
    const result = await shelleyJson<{ status?: string }>(
      `/conversation/${encodeURIComponent(input.shelleyConversationId)}/chat`,
      { method: "POST", json: { message: input.message, ...(input.queue ? { queue: true } : {}) } },
    );
    // The follow-up's turn ends with a finish the bot should hear about too.
    if (handoff.status === "finished") await reopenHandoff(handoff.id);
    return { status: result.status === "queued" ? "queued" : "accepted" };
  },

  async status(input) {
    const botId = await botOf(input.conversationId);
    const handoff = await findHandoff(botId, input.shelleyConversationId);
    if (!handoff) return undefined;
    const outcome = await readTurnOutcome(input.shelleyConversationId);
    let changedFiles: ShelleyChangedFile[] | undefined;
    if (handoff.cwd) {
      changedFiles = await shelleyJson<ShelleyChangedFile[]>(
        `/git/diffs/working/files?cwd=${encodeURIComponent(handoff.cwd)}`,
      ).catch(() => undefined);
    }
    return {
      working: outcome.working,
      slug: outcome.slug ?? handoff.slug,
      text: outcome.text,
      failed: outcome.failed,
      ...(Array.isArray(changedFiles) ? { changedFiles } : {}),
      url: codePath(input.shelleyConversationId),
    };
  },

  async list(conversationId) {
    return (await listHandoffs(await botOf(conversationId))).map(toRecord);
  },
};
