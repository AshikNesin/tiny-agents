# Past chats

"New chat" gives a bot a fresh conversation (issue #101). The chat it leaves
is not lost: it becomes a **past chat** that the owner can read, continue or
delete from the chat header's **Chat history** button (the clock next to New
chat). The sidebar row's ⋯ menu also has a **Chat history** item.

## What is stored

A past chat is a `BotChat` row (app.db) naming the retired durable
conversation (agent.db):

| Column               | Meaning                                                       |
| -------------------- | ------------------------------------------------------------- |
| `conversationId`     | The retired conversation; never sent to the client            |
| `startedAt`          | The bot's `chatStartedAt` while this was its chat             |
| `endedAt`            | When "New chat" (or continuing another past chat) retired it  |
| `title`              | Model-written title; the first owner message until it arrives |
| `lastMessagePreview` | The bot row's preview when it was retired                     |
| `messageCount`       | Owner and bot messages in it                                  |

`resetConversation` (`bots/bots.service.ts`) records the row after it stops
the old conversation (`recordPastChat` in `bots/chats.history.ts`). An empty
chat records nothing. Recording is best effort: if the transcript can't be
read, "New chat" still succeeds and the chat goes unlisted.

Chats retired before this feature shipped have no link back to their bot
(durable conversations are ownerless), so they are not listed.

## Titles

`bots/chats.title.ts` names a past chat with one side-call off the reset path:

- The model is `CHAT_TITLE_MODEL`, defaulting to the lightweight
  `custom:custom-zai-coding-plan/glm-5.3-flash`, a custom gateway provider
  (`GATEWAY_CUSTOM_PROVIDERS`). Custom models take the `custom:<provider>/<model>`
  form, so a bare `<provider>/<model>` value is not recognised. A model the
  runtime doesn't have (unknown, not configured on the deployment, or left out
  by `GATEWAY_MODEL_ALLOWLIST`) falls back to the bot's own model.
- The input is an excerpt (≤ 4,000 characters) from the start of the chat.
  The output is cleaned to one line of at most 80 characters.
- The call goes through the side-caller (`side-call.ts`, see Side-call in
  GLOSSARY.md), which picks the model, aborts it after 30 seconds and logs
  any failure. Any failure keeps the first owner message as the title. Faux
  mode has no side-caller, so it makes no title calls.

## Reading

| Route                                                 | Returns                                                   |
| ----------------------------------------------------- | --------------------------------------------------------- |
| `GET /api/v1/bots/:id/chats`                          | `{ chats }`, the most recently ended first                |
| `GET /api/v1/bots/:id/chats/:chatId`                  | `{ chat, state, runs }`: the newest 60 messages, windowed |
| `GET /api/v1/bots/:id/chats/:chatId/messages?before=` | Older messages, 50 at a time (as for the live chat)       |

A past chat is read once, with no stream: nothing runs in a retired
conversation. `runs` holds the routine cards that finished while it was the
bot's chat (`startedAt ≤ finishedAt < endedAt`). Another bot's `chatId` is a 404.

The client shows it at `/chats/:botId/history/:chatId` (`PastChatPane`) with
the same transcript rendering as the live chat. `ChatMessageView` runs in
`readOnly` mode there: approval, sign-in and question cards still waiting in
the retired conversation show "not answered" with no buttons.

## Continuing

`POST /api/v1/bots/:id/chats/:chatId/continue` moves the bot back onto the
past chat's conversation. It restores `conversationId`, `chatStartedAt` and
the preview, and deletes the `BotChat` row. The chat the bot was on is
stopped and becomes a past chat in turn. The conversation is reconciled
before its next turn, so it runs on the bot's current persona, model and
tools. Memory capture picks up from the bot's existing watermark, so only new
owner turns are captured.

A continued chat's routine cards start from when it first began, so runs that
landed during the other chat show in both.

## Deleting

`DELETE /api/v1/bots/:id/chats/:chatId` removes the row. The durable
conversation stays orphaned in agent.db, like a deleted bot's: pi-durable has
no conversation delete yet. Deleting a bot cascades its past chats.
