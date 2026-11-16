/**
 * The app's `VaultBroker` (issue #56): what the agent toolkits are given.
 * Tool calls know their conversation, not their bot, so this resolves the
 * bot (for per-bot item scoping and the approval card) and whether the turn
 * is unattended — a routine run or another bot's message. It never exposes a
 * write.
 */
import type { VaultBroker, VaultUse } from "@tiny-agents/agent";
import { getAgentRuntime } from "../bots/bots.runtime";
import { conversationOwner, isUnattended, type ChatReader } from "../bots/bots.owner";
import { vaultAlert } from "./vault.alerts";
import {
  audit,
  findItem,
  listFor,
  normalizeOrigin,
  planUse,
  runItemUse,
  type UseContext,
} from "./vault.service";

async function who(conversation: number, runtime: () => ChatReader): Promise<UseContext> {
  const owner = await conversationOwner(conversation);
  return {
    ...(owner ? { botId: owner.bot.id, botName: owner.bot.name } : {}),
    ...(owner?.bot.shared ? { shared: true } : {}),
    unattended: await isUnattended(conversation, runtime(), owner ?? null),
  };
}

/** The target's host only: a full URL can carry query secrets. */
function hostOf(target: string): string {
  try {
    return new URL(target).hostname;
  } catch {
    return "a target";
  }
}

export function createVaultBroker(runtime: () => ChatReader = getAgentRuntime): VaultBroker {
  return {
    async list(scope) {
      const context = await who(scope.conversation, runtime);
      return listFor({
        ...(context.botId ? { botId: context.botId } : {}),
        ...(scope.tool ? { tool: scope.tool } : {}),
        ...(scope.origin ? { origin: scope.origin } : {}),
      });
    },
    async plan(use) {
      const context = await who(use.conversation, runtime);
      const plan = await planUse(use, context);
      const bot = context.botName ?? "A bot";
      // Approvals push through the gate's wait (notifications.wiring.ts).
      if (plan.refused === "refused_origin") {
        vaultAlert(
          "refused",
          "Vault: refused fill",
          `${bot} tried to use ${use.handle} on ${hostOf(use.target)}, which the item doesn't allow (possible prompt injection).`,
        );
      }
      return plan;
    },
    async use(use, fields, sink) {
      return runItemUse(use, await who(use.conversation, runtime), fields, sink);
    },
    async record(use: VaultUse, outcome, reason) {
      const context = await who(use.conversation, runtime);
      const row = await findItem(use.handle);
      await audit({
        ...(row ? { item: row } : {}),
        handle: use.handle,
        botId: context.botId,
        conversationId: use.conversation,
        tool: use.tool,
        target: use.target,
        outcome,
        ...(reason ? { reason } : {}),
        unattended: context.unattended,
      });
    },
    async requested(request) {
      const context = await who(request.conversation, runtime);
      // The request's push goes out when its wait starts (notifications.wiring.ts).
      const origin = normalizeOrigin(request.origin);
      const saved = origin
        ? (await listFor({ ...(context.botId ? { botId: context.botId } : {}), origin })).find(
            (item) => item.kind === "login",
          )
        : undefined;
      return saved ? { savedHandle: saved.handle } : {};
    },
  };
}
