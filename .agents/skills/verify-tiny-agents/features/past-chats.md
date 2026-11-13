# Past chats

When a user starts a New chat, the chat they leave becomes a past chat in the bot's Chat history, named after its first message (or a model-written title) with its date range and message count. A past chat opens read-only; the user can go back to the current chat, continue the past chat (the chat they were on becomes a past chat in turn), or delete it after confirming.

## Sub-features

- `past-empty` with no past chats the bot menu's `Chat history` page (header `<bot> menu` → `Chat history`, also opened by the sidebar row menu's `Chat history`) says `No past chats yet. Starting a new chat keeps this one here.`
- `past-list` bot menu `Chat history` page: `data-testid=past-chat-item` rows with the title, range and `N messages`, most recently ended first.
- `past-title` without a title model (faux) the title is the first owner message.
- `past-read` the read-only view (`/chats/<botId>/history/<chatId>`): heading `<bot> / <title>`, transcript, footer `data-testid=past-chat-footer` (`Past chat · <title>`) instead of the composer; `Back to current chat`.
- `past-continue` `Continue this chat` (footer button or `Past chat actions` menu): toast `Chat continued…`, the live chat is the old conversation, and it keeps going.
- `past-row-menu` sidebar row `<bot> actions` → `Chat history` opens the bot menu on its history page.
- `past-delete` `Past chat actions` → `Delete chat` → dialog `Delete this chat?` → `Delete`: toast `Chat deleted`, back to the current chat, removed from the list.

## How to get to it (user POV)

- In a bot's chat: header `<bot> menu` (the bot's name) → `Chat history`. In a past chat the header keeps a clock button `Chat history`.
- Sidebar region `Bots`: hover a bot row, `<bot> actions` → `Chat history`.

## Driving it with ta-verify

Preconditions:

- Baseline run, doctor OK, signed in. A bot of the journey's own (`setup:` via the API).

- **Empty.** `<bot> menu` → `Chat history` → the text above; row menu → `Chat history` → the same page.
- **List.** Send `plan the trip <stamp>`, wait for the echo, `Start a new chat` → dialog `Start a new chat?` → `New chat`. Open `Chat history`: one item with the message text and `2 messages`; `GET /api/v1/bots/<id>/chats` has `title` = the message, `messageCount` 2.
- **Read.** Click the item: URL has `/history/`, heading contains the title, footer reads `Past chat · <title>`, no composer. `Back to current chat` returns.
- **Continue (footer).** Reopen it, footer `Continue this chat`: toast `Chat continued…`, not on `/history/`, the old echo shows, a new message gets its echo. The chats list is empty (the fresh chat was empty, so nothing new was recorded).
- **Row menu + actions menu.** Two more New chats with a message between them, open history from the row menu, open the newest, `Past chat actions` → `Continue this chat`.
- **Delete.** Open the remaining past chat, `Past chat actions` → `Delete chat`; the confirm names the title and bot; `Delete`. Toast `Chat deleted`, list empty in the API, the bot menu's `Chat history` page empty again.
- **Proof.** `ta-verify drive $S/journeys/past-chats.mjs` → `past-chats/history-list`, `continued`, `delete-confirm`, `deleted`.

## Gotchas

- An empty chat is never recorded: New chat on a fresh conversation, or continuing from one, adds no row.
- Faux mode makes no title side-call, so titles stay the first owner message; a real deployment may rename the chat a moment after New chat.
- Wait for each reply to finish (`Send message` visible again) before New chat, or the message count differs.
- The sidebar row's actions button appears on hover only: hover the row first.
- New chat itself and the basic read-only view are also in `chats.mjs`; this journey covers the rest.
