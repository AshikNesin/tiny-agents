/**
 * Whether a bot's current turn is the owner's own. Tool calls know their
 * conversation, not who is behind the turn, so writes the owner must make
 * themselves (vault uses, memory changes) read it from the conversation's
 * latest user message.
 */
import type { AgentRuntime } from "@tiny-agents/agent";

/** The label every routine prompt starts with (`composeRoutineLabel`). */
const ROUTINE_PROMPT = /^\*\*Routine "/;

export type ChatReader = Pick<AgentRuntime, "readChat">;

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
