import type { VaultBroker, VaultUse } from "@tiny-agents/agent";
import { getAgentRuntime } from "../bots/bots.runtime";
import { isUnattended, ownerTurnOf, type ChatReader } from "../bots/bots.owner";
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
  const turn = await ownerTurnOf(conversation, runtime);
  if (turn.status === "disabled") {
    return { unattended: await isUnattended(conversation, runtime(), null) };
  }
  const { bot } = turn.owner;
  return {
    botId: bot.id,
    botName: bot.name,
    ...(bot.shared ? { shared: true } : {}),
    unattended: turn.status === "unattended",
  };
}

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
