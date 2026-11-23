import type { ChatMessage } from "./chat-types";

export interface LastTurn {
  at: string;
  text: string;
}

const SAVED = /^e\d+$/;

export function lastTurn(messages: readonly ChatMessage[]): LastTurn | null {
  const last = messages.findLast(
    (message) => message.role === "user" && message.peer === undefined && SAVED.test(message.id),
  );
  return last ? { at: last.id, text: last.text } : null;
}
