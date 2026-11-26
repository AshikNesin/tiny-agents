# ADR 0040: A project chat is a bot tied to one Code project

- Status: **accepted** (builds on [0021](0021-code-projects-and-worktrees.md), [0039](0039-code-threads-and-runs.md))
- Date: 2026-11-24

## Context

The owner wanted one conversation per project that takes asks, hands the
work to Code threads and reports back, in the spirit of Claude Projects
(design: issue 525). Bots already had most of it: a chat on web and Android,
`code_start` and `code_send` hand-offs whose finish comes back as a quiet
"Reply from" turn, batched wakes, `message_owner`, memory, routines and
push.

## Decision

**A project chat is a bot with `bots.project_id` set.** One per project
(unique column). Opening the chat from the Code sidebar makes it on first
use (`openProjectChat` in `code.chat.ts`) and shows its `ChatPane` inside
Code at `/code/p/<project>`. Deleting the project leaves a plain bot;
deleting the bot removes the chat.

**It only coordinates.** A project bot gets `PROJECT_BOT_TOOLKITS`
(`bot-toolkits.ts`) instead of `BOT_TOOLKITS`: the `project` toolkit in
place of `code`, and no sandbox, browser, computer, vault, bot builder,
self-improve or bot messaging. Every change is made by a thread on its own
branch, where it can be reviewed as a diff. The smaller tool list also
makes each of its requests cheaper.

**The `project` toolkit is the `code` tools, scoped and not deferred.**
`code_start` works only in the bot's project, `code_list` lists every open
thread of the project with its derived status, and `code_resolve` archives a
finished one. Its prompt section (`coordinatorRules` in
`packages/agent/src/toolkits/code.ts`) names the project and holds the
owner's project instructions. The tools are direct, since coordinating is
the bot's whole job.

**Project instructions live on the project** (`settings.instructions`), and
reach both the chat (its section) and every new thread of the project (the
thread's first message, after the branch line). Running threads keep what
they started with.

## Consequences

- No new chat, memory, push or Android code: the project chat is a bot in
  every one of those.
- A project bot's own system prompt stays the owner's to edit; the
  coordinator rules come from the section, so they change with the code.
- Threads the owner starts in the project do not report to the chat; only
  the ones it started or took over with `code_send` do.
- On the web, a project chat lives only in Code: the Chat sidebar, its
  phone list and the palette's Bots leave it out, and its `/chats/<id>` link
  opens `/code/p/<project>` (issue #567). Android lists it with the bots,
  since it has no project chat screen.
