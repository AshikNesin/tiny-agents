---
"@tiny-agents/agent": minor
"@groot/web": minor
---

Share bots with guests (issue #145): a collaborative chat where the owner and a
guest write in the same conversation with a bot.

`@groot/web` adds guests (Settings → People: name, email and a password the
owner passes on) and per-bot sharing (bot settings → Sharing). A shared bot's
chat is one conversation everybody in it sees live; each message shows its
sender, and the bot reads it as `Name: message` with a prompt line naming
everyone and asking it to reply `[skip]` when people only talk to each other
(those replies are hidden and leave the Bot list alone). Guests reach only the
bots shared with them (chat, approvals, Questions, live browser and computer
views), uploads, Code and their own account; every other route answers 403
(`guest.guard.ts`, default-deny). In a shared chat every vault use asks and
only the owner may approve it, and memory capture and injection are off. New
tables `guests` and `bot_guests` (migration 0005). Nothing changes until a
guest is added: an account with no `guests` row is the owner.

`@tiny-agents/agent` adds `ChatMessage.author` / `QueuedMessage.author` (the
trusted sender, stored on the entry by `submit({ author })`, with the name
prefix stripped from the transcript text), `authoredText`, `SKIP_REPLY` and
`isSkipReply`.
