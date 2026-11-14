# Message paging

A long conversation opens on its newest messages only. When the owner scrolls up to the top of the transcript, the next older page loads above, without the view jumping, until the first message of the conversation is on screen. The same happens in a past chat opened from Chat history, which pages through its own conversation.

## Sub-features

- `paging-window` a chat opens on its newest 60 messages, with the line `Earlier messages` (`data-testid=older-messages`) above them; nothing older is fetched on open.
- `paging-scroll` scrolling up near the top (wheel, touch or keyboard first) loads 50 older messages per page (`Loading earlier messages…` while it does), each page asked for with a cursor: the id of the oldest message on screen.
- `paging-end` once the first message is loaded, the `Earlier messages` line is gone.
- `paging-complete` the loaded transcript is complete and in order: every message once, no gaps or duplicates between pages.
- `paging-past` a past chat (`/chats/<botId>/history/<chatId>`) opens on its newest 60 messages too and pages the same way from its own endpoint.

## How to get to it (user POV)

- Any bot's chat with more than 60 messages (`/chats/<botId>`): scroll the transcript up.
- A past chat with more than 60 messages: header `<bot> menu` → `Chat history` → the chat → scroll up.

## Driving it with ta-verify

Preconditions:

- Baseline run, doctor OK, signed in. A bot of the journey's own with 60 exchanges (120 messages), `setup:` through `POST /api/v1/bots/<id>/messages`, waiting after each send until `GET /api/v1/bots` shows the bot idle with that exchange's echo as its preview (about 1 minute at 6 tokens/s).

- **Window.** Open `/chats/<botId>`. In region `Messages`: `Echo: msg 060 <stamp>` shows, `older-messages` reads `Earlier messages`, `msg 031 <stamp>` is the oldest message rendered, `msg 030`/`msg 001` are absent (30 user bubbles). No request with `?before=` has been made.
- **Scroll.** Hover the transcript and wheel up until `msg 001 <stamp>` is in the viewport. Exactly two requests went to `GET /api/v1/bots/<id>/messages?before=<id>&limit=50`: page 1 has 50 messages (`msg 006` … `Echo: msg 030`, `hasMore: true`), page 2 is cursored on page 1's oldest id and has the last 10 (`msg 001` …, `hasMore: false`); the pages share no id and neither contains its cursor.
- **Complete.** `older-messages` is gone; the user bubbles read `msg 001` … `msg 060` in order, the echoes `Echo: msg 001` … `Echo: msg 060`.
- **Past chat.** `Start a new chat` → dialog `Start a new chat?` → `New chat`. `GET /api/v1/bots/<id>/chats` has one chat titled `msg 001 <stamp>` with `messageCount` 120. `Chat history` → the item (`120 messages`) → `/history/<chatId>`: the same window (no cursor request), then the same scroll, now against `GET /api/v1/bots/<id>/chats/<chatId>/messages?before=…` (never the live endpoint), and the same complete transcript.
- **Proof.** `ta-verify drive $S/journeys/message-paging.mjs` → `message-paging/live-window`, `live-oldest`, `past-window`, `past-oldest`. Cleanup deletes the bot.

## Gotchas

- Window 60 (`CHAT_WINDOW`) and page 50 (the client's `limit`) are fixed; 60 exchanges give one full and one partial page, so the end of history is reached too.
- The loader arms only after the owner's own wheel, touch or key input in the transcript: a programmatic `scrollTop` change does not load anything. Use `page.mouse.wheel` over the transcript.
- `toBeVisible` does not mean on screen: assert the oldest message with `toBeInViewport`.
- Scope message text to region `Messages`: the sidebar row shows the latest echo as its preview.
- The client drops duplicate ids when it prepends a page, so check page disjointness on the responses, not only on screen.
- The transcript renders every loaded message (no virtualisation), so `allTextContents()` reads the whole loaded history.
