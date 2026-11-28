import type { ArtifactStore } from "@tiny-agents/agent";
import { conversationOwner } from "../bots/bots.owner";
import { commitArtifact, createArtifact, listArtifacts, readArtifact } from "./artifacts.service";

export const artifactStore: ArtifactStore = {
  async create(conversationId, input) {
    const owner = await conversationOwner(conversationId);
    if (!owner) throw new Error("No bot owns this conversation.");
    const { idempotencyKey, ...rest } = input;
    return createArtifact({
      ...rest,
      botId: owner.bot.id,
      conversationId,
      sourceKey: idempotencyKey,
    });
  },

  async commit(conversationId, input) {
    const { idempotencyKey, ...rest } = input;
    return commitArtifact({ ...rest, conversationId, sourceKey: idempotencyKey });
  },

  async read(conversationId, slug, seq) {
    return readArtifact(conversationId, slug, seq);
  },

  async list(conversationId) {
    return listArtifacts(conversationId);
  },
};
