import type { ChatEvent, ChatState } from "../../../packages/agent/src/index";

export function applyChatEvents(previous: ChatState, events: readonly ChatEvent[]): ChatState {
  let state = structuredClone(previous);
  for (const event of events) {
    switch (event.type) {
      case "snapshot":
        state = structuredClone(event.state);
        break;
      case "upsert":
        state = {
          ...state,
          messages: [
            ...state.messages.filter((message) => message.id !== event.message.id),
            event.message,
          ],
        };
        break;
      case "remove":
        state = { ...state, messages: state.messages.filter((message) => message.id !== event.id) };
        break;
      case "delta":
        state = {
          ...state,
          messages: state.messages.map((message) =>
            message.id === event.id
              ? {
                  ...message,
                  text: message.text + (event.text ?? ""),
                  ...(event.reasoning
                    ? { reasoning: (message.reasoning ?? "") + event.reasoning }
                    : {}),
                }
              : message,
          ),
        };
        break;
      case "busy":
        state = { ...state, busy: event.busy };
        break;
      case "queued":
        state = { ...state, queued: event.items };
        break;
    }
  }
  return state;
}
