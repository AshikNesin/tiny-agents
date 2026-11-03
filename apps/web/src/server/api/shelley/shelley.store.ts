/**
 * ShelleyStore adapter (issue #143): what the agent's `shelley_*` tools
 * (packages/agent/src/toolkits/shelley.ts) run against. It starts and steers
 * Shelley conversations through Shelley's API and records hand-offs, always
 * scoped to the bot that owns the asking conversation (its chat or one of
 * its routines).
 */
import type { ShelleyChangedFile, ShelleyHandoffRecord, ShelleyStore } from "@tiny-agents/agent";
import { Boom, HttpError } from "@groot/core/errors";
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
  type TurnOutcome,
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
    let handoff = await findHandoff(botId, input.shelleyConversationId);
    // An existing conversation (started earlier, in Shelley or on the Code
    // page): check Shelley has it, then adopt it so its finish comes back.
    let adopt: TurnOutcome | undefined;
    if (!handoff) {
      try {
        adopt = await readTurnOutcome(input.shelleyConversationId);
      } catch (error) {
        if (error instanceof HttpError && error.statusCode === 404) return { error: "not_found" };
        throw error;
      }
    }
    const result = await shelleyJson<{ status?: string }>(
      `/conversation/${encodeURIComponent(input.shelleyConversationId)}/chat`,
      { method: "POST", json: { message: input.message, ...(input.queue ? { queue: true } : {}) } },
    );
    if (adopt) {
      handoff = await recordHandoff({
        botId,
        idempotencyKey: input.idempotencyKey,
        task: input.message,
        ...(adopt.cwd ? { cwd: adopt.cwd } : {}),
        shelleyConversationId: input.shelleyConversationId,
        slug: adopt.slug,
      });
    } else if (handoff?.status === "finished") {
      // The follow-up's turn ends with a finish the bot should hear about too.
      await reopenHandoff(handoff.id);
    }
    return { status: result.status === "queued" ? "queued" : "accepted" };
  },

  async status(input) {
    await botOf(input.conversationId);
    let outcome: TurnOutcome;
    try {
      outcome = await readTurnOutcome(input.shelleyConversationId);
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 404) return undefined;
      throw error;
    }
    let changedFiles: ShelleyChangedFile[] | undefined;
    if (outcome.cwd) {
      changedFiles = await shelleyJson<ShelleyChangedFile[]>(
        `/git/diffs/working/files?cwd=${encodeURIComponent(outcome.cwd)}`,
      ).catch(() => undefined);
    }
    return {
      working: outcome.working,
      slug: outcome.slug,
      text: outcome.text,
      failed: outcome.failed,
      ...(Array.isArray(changedFiles) ? { changedFiles } : {}),
      url: codePath(input.shelleyConversationId),
    };
  },

  async models() {
    const list =
      await shelleyJson<
        Array<{ id: string; display_name?: string; ready?: boolean; is_default?: boolean }>
      >("/models");
    return (Array.isArray(list) ? list : [])
      .filter((m) => m.ready !== false)
      .map((m) => ({
        id: m.id,
        ...(m.display_name ? { name: m.display_name } : {}),
        isDefault: Boolean(m.is_default),
      }))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  },

  async list(conversationId) {
    return (await listHandoffs(await botOf(conversationId))).map(toRecord);
  },
};
