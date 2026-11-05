---
"@groot/web": minor
---

Bot chat stream and chat session refactor; the UI looks and behaves as before.

- One wire contract for the bot stream: `BotStreamEvent` and
  `EventsFeedEvent` (with `RoutineRunCard`, the `BotListEntry` row and a
  `Jsonified<T>` helper) live in `apps/web/src/shared` and type both the
  server's SSE writes (`openSse<E>`) and the client. The client re-exports
  the agent package's chat types instead of copying them.
- `followBotChat(bot, sink)` (`bots.stream.ts`) owns every source of a bot's
  chat stream (viewer count, transcript window, routine cards, YOLO mode, the
  bot moving to another chat) and their order, on one per-bot event bus
  (`bots.events.ts`) that replaces three listener sets. Card and YOLO events
  that land while a stream starts are no longer lost to the first read.
- A chat session owns the Echo and the outbox: `useChat(botId)` returns a
  ready-to-render view (timeline, outbox, busy, typing, health, unread
  divider, YOLO) and the chat's commands, from a pure reducer
  (`lib/chat-session.ts`) and a sessions store behind ports
  (`store/chats.ts`). The bots store's `adoptBot(bot)` stores a fresh row,
  drops a chat whose conversation changed and refreshes the list.
- `viewOf(call, { readOnly })` (`lib/tool-call-view.ts`) decides how a tool
  call is shown; the chat's cards and rows derive from it.
