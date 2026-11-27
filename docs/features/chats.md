# Chats

A bot's chat at `/chats/:botId` is one column: the transcript, the composer,
and a header with the bot menu, live view, **Past chats** and **New chat**.

## Sidebar

The bots list groups bots by what they need (`groupBots` in
`apps/web/src/client/lib/bot-groups.ts`):

- **Needs you**: a bot waiting on your approval or your answer to its
  questions.
- **Working**: a bot replying now.
- **Pinned**, then **Recent**, newest first; Recent folds after a few rows.

Tasks, Terminal, Computer and Browser sit in one row of icons above the bots.

With a coding agent connected, the owner sees **Threads** above the bots
(`ThreadsSection.tsx`): the Code threads that need you or are still working,
needing-you first (`activeThreads` in `apps/web/src/client/lib/code/list.ts`),
each with who started it, a bot or a project chat (`startedBy` on the thread
list, from the thread's first hand-off). **All threads** opens Code. The
Android drawer shows the same section above its bots.

## Keys

The chat page uses the same single-letter keys as the Code workspace, from
`components/keys.tsx`. The list lives in `ChatPane.tsx`; `?` shows it, and the
command palette runs the same commands under **Chat actions**. Letters typed
in the composer are text; Escape outside it stops a reply.

## The `/` menu: commands, skills and tools

Typing `/` at the start of a message opens one menu (the owner only;
`activeSkillToken` in `lib/composer-draft.ts`, `SlashSkills.kt` on Android).
`slashEntries` in `lib/slash-menu.ts` builds it for the chat and the Code
composer alike:

- **Commands:** `/new` starts a new chat.
- **Skills:** the bot's skills. A pick writes `/skill-name `, and the skills
  prompt section in `packages/agent/src/skills.ts` tells the model that such a
  message asks for that skill. Typing the name by hand works the same.
- **Tools:** each connection the bot reaches, and, once you type, its single
  tools (by connection, tool name or label). Tools set to Off are left out
  (`GET /bots/:id/tools`, `botToolChoices` in `chats.service.ts`). A pick is a
  chip above the composer, sent as `tools` with the message. The server checks
  each pick against that same list and puts one line naming them at the top of
  the message (`withToolPicks` in `apps/web/src/shared/tool-picks.ts`), so the
  model loads those tools and uses them. The sent message shows them as chips,
  not as that line.

## Long replies

Runs of finished tool calls fold into one row (`toolSteps`). When a reply has
finished and its work is more than one row, the tool calls and reasoning above
the answer fold into one **Worked: ...** line with what failed and how long it
took (`workFold` in `lib/tool-call-text.ts`). It stays open while the bot
works, and around a card you act on, such as an approval or a question.

## Edit and Run again

Your last message has **Edit** and **Run again** (keys `e` and `t`) while the
bot is idle (`lastTurn` in `lib/last-turn.ts`).

- **Run again** goes back to before that message and sends it again.
- **Edit** puts it in the composer; sending goes back to before it and sends
  the edited text. Cancel leaves the chat as it is.

Going back is `POST /api/v1/bots/:id/rewind` with the message id
(`rewindChat` in `bots/chats.service.ts`). It forks the conversation just
before that message and moves the bot onto the fork. The chat as it was
becomes a past chat, so continuing it from **Past chats** undoes the edit. The
server refuses while a reply is running (409). Editing the first message
starts an empty chat. Attachments on the message are not sent again.
