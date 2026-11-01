---
"groot": minor
"@groot/web": minor
---

Past chats (issue #101). "New chat" no longer hides the chat it replaces: the
chat header has a Chat history button (also in the sidebar row's ⋯ menu)
listing each bot's earlier chats with a title, dates and a preview. Opening
one shows it read-only, with older messages loading on scroll and the routine
results from that period. From there you can continue the chat (the bot moves
back onto it, and the chat it was on becomes a past chat) or delete it.
Titles come from one lightweight side-call per "New chat" (`CHAT_TITLE_MODEL`,
default `custom:custom-zai-coding-plan/glm-5.3-flash`), with the first
message as the fallback. Adds the `BotChat` table (migration
`20261030170000_bot_chats`). Chats ended before this release can't be
recovered: nothing linked them to their bot.
