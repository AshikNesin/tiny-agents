# Chats with bots

A user creates a bot, chats with it and watches the reply stream in. The conversation survives a reload. `New chat` starts a clean transcript and moves the old one to `Chat history`, where it opens read-only.

## Sub-features

- `chats-create-bot` creates a named bot from the `New bot` dialog with a model.
- `chats-send` sends a message and streams the bot's reply into the transcript.
- `chats-reload` keeps the transcript after a full reload.
- `chats-new` clears the transcript with `New chat`.
- `chats-history` reopens an earlier chat read-only from `Chat history`.
- `chats-fold` folds a finished reply's tool calls and reasoning into one `Worked: ...` line (`data-testid=reply-work`).
- `chats-retry` reruns your last message from before it (`t`, or `Run this again` on the message); the chat as it was becomes a past chat.
- `chats-edit` puts your last message in the composer (`e`, or `Edit this message`); sending goes back to before it (`data-testid=editing-banner` while editing).
- `chats-keys` lists the chat's keys on `?` (`data-testid=code-keys`).
- `chats-needs-you` moves a bot that asks a question under the sidebar list `Needs you`.

## How to get to it (user POV)

- `/chats` after sign-in. Empty account: `Create your first bot`; otherwise sidebar region `Bots` → `New bot`.
- A bot's chat: its link in the `Bots` sidebar list (`/chats/<botId>`).
- New chat: `Start a new chat` (starts at once, no confirm; the old chat goes to Chat history). History: the header's `Past chats` button, or `h`.

## Driving it with ta-verify

Preconditions:

- Baseline run, doctor OK, signed in. The faux model is listed.

- **Create bot.** Open the dialog, wait for the button `Test Model (faux)` (the catalog loads async), fill `Name` with `Verify Bot <stamp>`, press `Create bot`. Dialog closes; a sidebar link with that name appears; `GET /api/v1/bots` has the row.
- **Send.** In the composer (placeholder `Ask <bot name>…`/`Message <bot name>…`) type `hello <stamp>`, press Enter. The user bubble shows, then `Echo: hello <stamp>` within ~30 s.
- **Reload.** `page.reload()`. The echo is still visible.
- **New chat.** `Start a new chat`, no dialog. No `Echo: hello <stamp>` text left.
- **History.** `Past chats` → the first `data-testid=past-chat-item` containing `hello <stamp>` (Run again and Edit also leave past chats). URL contains `/history/`; the echo shows; `data-testid=past-chat-footer` (Continue) replaces the composer.
- **Fold.** Send `/trace`; `reply-work` contains `Worked:`. Wait for `Here is where things stand:` and the `Run this again` button before pressing keys: Edit and Run again are off while the bot replies.
- **Run again.** Blur the composer, press `t`; `GET /api/v1/bots/<id>/chats` lists one past chat and `/trace` shows once.
- **Edit.** Press `e`; the composer holds `/trace`; fill `edited <stamp>`, Enter; `Echo: edited <stamp>` shows and `/trace` is gone.
- **Needs you.** Send `/ask <stamp>`; the list `Needs you` has the bot's link; `Dismiss` clears it.
- **Proof.** `ta-verify drive $S/journeys/chats.mjs` → `chats/reply`, `chats/folded`, `chats/edited`, `chats/sidebar`, `chats/history`. Cleanup deletes the bot and confirms it is gone from `GET /api/v1/bots`.

## Gotchas

- Bot names are unique; a second bot with the same name fails. Always stamp names.
- The faux model streams at 6 tokens/s on purpose (so mid-reply tests have a window); allow ~30 s for longer echoes.
- Creating before the faux model button appears fails validation silently in the dialog.
- `Chat history` does not render until the bot has at least one past chat.
