# Chats with bots

A user creates a bot, chats with it and watches the reply stream in. The conversation survives a reload. `New chat` starts a clean transcript and moves the old one to `Chat history`, where it opens read-only.

## Sub-features

- `chats-create-bot` creates a named bot from the `New bot` dialog with a model.
- `chats-send` sends a message and streams the bot's reply into the transcript.
- `chats-reload` keeps the transcript after a full reload.
- `chats-new` clears the transcript with `New chat`.
- `chats-history` reopens an earlier chat read-only from `Chat history`.

## How to get to it (user POV)

- `/chats` after sign-in. Empty account: `Create your first bot`; otherwise sidebar region `Bots` → `New bot`.
- A bot's chat: its link in the `Bots` sidebar list (`/chats/<botId>`).
- New chat: `Start a new chat` → `New chat`. History: `Chat history` (shown only once a past chat exists).

## Driving it with ta-verify

Preconditions:

- Baseline run, doctor OK, signed in. The faux model is listed.

- **Create bot.** Open the dialog, wait for the button `Test Model (faux)` (the catalog loads async), fill `Name` with `Verify Bot <stamp>`, press `Create bot`. Dialog closes; a sidebar link with that name appears; `GET /api/v1/bots` has the row.
- **Send.** In the composer (placeholder `Ask <bot name>…`/`Message <bot name>…`) type `hello <stamp>`, press Enter. The user bubble shows, then `Echo: hello <stamp>` within ~30 s.
- **Reload.** `page.reload()`. The echo is still visible.
- **New chat.** `Start a new chat` → `New chat` (exact). No `Echo: hello <stamp>` text left.
- **History.** `Chat history` → `data-testid=past-chat-item` containing `hello <stamp>`. URL contains `/history/`; the echo shows; `data-testid=past-chat-footer` (Continue) replaces the composer.
- **Proof.** `ta-verify drive $S/journeys/chats.mjs` → `chats/reply`, `chats/history`. Cleanup deletes the bot and confirms it is gone from `GET /api/v1/bots`.

## Gotchas

- Bot names are unique; a second bot with the same name fails. Always stamp names.
- The faux model streams at 6 tokens/s on purpose (so mid-reply tests have a window); allow ~30 s for longer echoes.
- Creating before the faux model button appears fails validation silently in the dialog.
- `Chat history` does not render until the bot has at least one past chat.
