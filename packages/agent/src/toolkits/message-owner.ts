/**
 * `message_owner`, the bot's one way to speak when the owner did not start
 * the turn (issue #396, after the Grok bot's "send user" tool): a routine
 * run, a Code hand-off's finish, another bot's reply. There the bot's plain
 * reply is its own working: clients fold it away, and nothing pushes. A call
 * is the message: clients show its text, and the app pushes it when nobody
 * has the chat open (or as the routine run's result).
 *
 * The call's `text` argument is the record (`ChatMessage.sent`,
 * `FinishedReply.sent`); the tool itself stores nothing, like
 * `report_routine_blocked`.
 */
import { Type } from "@earendil-works/pi-ai";
import { tool } from "../toolkit";
import type { ChatToolCall } from "../types";

const MESSAGE_OWNER = "message_owner";
/** The longest message one call may send. */
const MAX_MESSAGE = 2_000;

/** The texts a message's finished `message_owner` calls sent, in order. */
export function sentTextsOf(calls: readonly ChatToolCall[] | undefined): string[] {
  const sent: string[] = [];
  for (const call of calls ?? []) {
    if (call.name !== MESSAGE_OWNER || call.status !== "done") continue;
    const text = call.args.text;
    if (typeof text === "string" && text.trim()) sent.push(text.trim());
  }
  return sent;
}

export const messageOwnerTool = tool({
  name: MESSAGE_OWNER,
  label: "Messaged you",
  askLabel: "message you",
  summary: "Send you a message when you didn't start the turn",
  // It only marks the turn; the app delivers. Asking would defeat it.
  policy: { readOnly: true },
  description:
    "Send the owner a message. When the owner didn't start this turn (a routine run, a hand-off " +
    "result, another bot's reply), only this reaches them; your plain reply stays private. Send " +
    "only what is worth their attention, and nothing when there is nothing new.",
  parameters: Type.Object({
    text: Type.String({ minLength: 1, maxLength: MAX_MESSAGE }),
  }),
  replay: "safe",
  execute: async (args) =>
    args.text.trim()
      ? { output: [{ type: "text", text: "Sent." }] }
      : { output: [{ type: "text", text: "Not sent: the message is empty." }], isError: true },
});
