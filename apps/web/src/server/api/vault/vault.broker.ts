/**
 * The app's `VaultBroker` (issue #56): what the agent toolkits are given.
 * Tool calls know their conversation, not their bot, so this resolves the
 * bot (for per-bot item scoping and the approval card) and whether the turn
 * is unattended — a routine's prompt or another bot's message — from the
 * conversation's latest user message. It never exposes a write.
 */
import { prisma } from "@groot/core/database";
import { notifyVaultAlert } from "../notifications/notifications.wiring";
import type { AgentRuntime, VaultBroker, VaultUse } from "@tiny-agents/agent";
import { getAgentRuntime } from "../bots/bots.runtime";
import {
  audit,
  findItem,
  listFor,
  normalizeOrigin,
  planUse,
  useItem,
  type UseContext,
} from "./vault.service";

/** The label every routine prompt starts with (`composeRoutineLabel`). */
const ROUTINE_PROMPT = /^\*\*Routine "/;

type ChatReader = Pick<AgentRuntime, "readChat">;

/**
 * True when the conversation's latest user message is not the owner's own:
 * a peer delivery (another bot, a relayed reply or a mention) or a routine.
 * Unknown counts as unattended, which only ever refuses more.
 */
export async function isUnattended(conversation: number, runtime: ChatReader): Promise<boolean> {
  try {
    const state = await runtime.readChat(conversation);
    const last = state.messages.findLast((message) => message.role === "user");
    if (!last) return true;
    return last.peer !== undefined || ROUTINE_PROMPT.test(last.text);
  } catch {
    return true;
  }
}

async function who(conversation: number, runtime: () => ChatReader): Promise<UseContext> {
  const bot = await prisma.bot.findUnique({
    where: { conversationId: String(conversation) },
    select: { id: true, name: true },
  });
  return {
    ...(bot ? { botId: bot.id, botName: bot.name } : {}),
    unattended: await isUnattended(conversation, runtime()),
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
        notifyVaultAlert(
          "refused",
          "Vault: refused fill",
          `${bot} tried to use ${use.handle} on ${hostOf(use.target)}, which the item doesn't allow (possible prompt injection).`,
        );
      }
      return plan;
    },
    async use(use, fields, sink) {
      return useItem(use, await who(use.conversation, runtime), fields, sink);
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
