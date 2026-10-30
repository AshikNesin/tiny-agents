/**
 * Whether a bot's current turn is the owner's own. Tool calls know their
 * conversation, not who is behind the turn, so writes the owner must make
 * themselves (vault uses, memory changes) read it from the conversation:
 * a routine's conversation is never the owner's, and in the chat the
 * latest user message says who wrote it.
 */
import type { AgentRuntime } from "@tiny-agents/agent";
import { isRoutineConversation } from "./bots.owner";

export type ChatReader = Pick<AgentRuntime, "readChat">;

/**
 * True when the turn is not the owner's own: a routine run (its own
 * conversation, issue #63) or a peer delivery in the chat (another bot, a
 * relayed reply or a mention). Unknown counts as unattended, which only ever
 * refuses more.
 */
export async function isUnattended(conversation: number, runtime: ChatReader): Promise<boolean> {
  try {
    if (await isRoutineConversation(conversation)) return true;
    const state = await runtime.readChat(conversation);
    const last = state.messages.findLast((message) => message.role === "user");
    if (!last) return true;
    return last.peer !== undefined;
  } catch {
    return true;
  }
}
