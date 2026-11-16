# tiny-agents verification map

This directory is the maintained source for verifying the user-facing behavior of tiny-agents. Read the index before driving the app, then use the matching feature file as the recipe. Every feature has a journey in `../journeys/` that runs the recipe end to end.

## Baseline preconditions

- A run started with `ta-verify up` (default `http://localhost:3100`), seeded with only the demo user `demo@example.com` / `demo@example.com`.
- Faux model on (`TINY_AGENTS_FAUX=1`): bots reply `Echo: <message>`, the model picker offers `Test Model (faux)`. Scripted triggers: `/ask` (question cards), `/browse N` (browser tool rounds), `/code [cwd=PATH] task` (coding hand-off), `/improve` and `/improve long` (instruction-change approval), `/newbot NAME` (bot-creation approval).
- A random per-run `SECRETS_KEY` and `ADMIN_AUTH_KEY`; no AI provider keys, no Pushover (doctor fails unless push is `not_configured`), nothing from the shell or `.env`.
- No sandbox unless `--sandbox`, no coding agent unless `--shelley`, demo user present unless `--empty`.
- `ta-verify doctor --run <id>` exits 0 before the first drive and after any failed drive.
- Never drive an instance this run did not start.

## Driving conventions

- Start every recipe from the baseline state plus a signed-in demo user (`journey()` signs in unless `{ signIn: false }`).
- ARIA roles and accessible names first; `data-testid` only where the app ships one. Canvas views (terminal, VNC) are proven through WebSocket frames, network responses or sandbox read-backs, never pixels alone.
- Every name a recipe creates carries the drive's `stamp`; register `cleanup()` right after creating it.
- Setup through the API is allowed only for state that is not the feature under test (e.g. a bot for a routine). Say so in the step name (`setup: …`).
- A step that catches a product bug keeps asserting the correct behaviour and runs last where possible, so the rest of the recipe's proofs are captured first.
- Auth is rate-limited to 20 attempts per 15 minutes per instance (logins and vault step-ups). Spread a full pass over several runs (see below).

## Proof and skip reporting

- `proof(label)` after each meaningful state change: screenshot + ARIA snapshot under `data/verify-evidence/<run>/<feature>/`.
- Mutations are confirmed by a second view: reload, another tab, or the row read back through `api`.
- Record unreachable paths with the attempted route and the unmet prerequisite. Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 and one paragraph of user-visible behavior, then exactly four H2s in order: `Sub-features`, `How to get to it (user POV)`, `Driving it with ta-verify`, `Gotchas`. Keep implementation details out; name user paths, stable handles, required state, commands and observable proof.

## Features

Journey file = feature file name with `.mjs`. Launch option in brackets where one is needed.

Accounts and shell

- [Sign in and out](./auth.md): login form, wrong-password error, logout, protected-route redirect.
- [First-run setup](./setup.md) [`--empty`]: `/setup` creates the first account, then closes.
- [Passkeys](./passkeys.md): add, rename, delete, sign in with a passkey (CDP virtual authenticators).
- [Account and shell](./account-shell.md): account menu, theme, sidebar rail, Settings sections and People, phone layout.
- [Command palette](./command-palette.md): ⌘K open/close, search, navigation and actions.
- [App settings](./settings.md): create, edit, persist and delete a JSON setting.
- [Notifications](./notifications.md): not-configured state, event settings, attention badges and tab title.

Chats

- [Chats with bots](./chats.md): create a bot, streamed reply, reload, New chat, Chat history.
- [Past chats](./past-chats.md): titles, read-only view, continue, delete.
- [Message paging](./message-paging.md): older messages load on scroll-back in live and past chats, in order, no duplicates.
- [Chat attachments](./chat-attachments.md): images and text files, image-only sends, refused uploads.
- [Message steering](./message-steering.md): steer, queue, withdraw and stop while a reply streams.
- [Questions for the owner](./questions.md): `/ask` cards, answers, skip, dismiss.
- [Bot settings](./bot-settings.md): edit dialog, unique names, pin, delete.
- [Tool permissions](./tool-permissions.md): Allow/Ask/Off, approval cards, always allow.
- [YOLO mode](./yolo.md): confirm, banner, auto-approval, off on New chat.
- [Self-improvement](./self-improve.md): `/improve` approval, Read more, the prompt really changes.
- [Bot builder](./bot-builder.md): `/newbot` approval card with the whole new bot, deny creates nothing, approve creates the bot.
- [Auto-review](./auto-review.md): the switch and its no-classifier behaviour.
- [Bot-to-bot](./bot-to-bot.md): `@` mentions and relayed peer replies.
- [Shared bots and guests](./shared-bots.md): guests, sharing, what a guest can and can't reach.
- [Memory](./memory.md): `/memory` add, edit, search, learning switch, delete.

Work

- [Tasks](./tasks.md): quick add, edit, complete, reopen, delete.
- [Routines](./routines.md): schedule preview, paused routine, Run now, the quiet chat line.
- [Scheduled routines](./routine-schedule.md): a routine fires on its own clock; edit, pause/resume, delete.
- [End-to-end workflow](./workflow-e2e.md): bot + skill + vault-backed MCP connection + scheduled routine, the result in chat, wiring after reload.
- [Skills](./skills.md): create, edit, attach to bots, import, delete.
- [Connections (MCP)](./connections.md): against a real local MCP server the journey starts.
- [Vault](./vault.md): every item kind, step-up, masking, reveal, policy, delete.
- [Vault step-up with a passkey](./vault-passkey.md): Use a passkey, refused foreign and unknown passkeys, edit in the same window.
- [Models](./models.md): catalog, picker and chip on the faux account.
- [Storage](./storage.md): folders, byte-exact upload/download, rename, bulk delete.
- [Jobs](./jobs.md): list, filters, detail, cancel/resume, re-run, delete.
- [Jobs admin](./jobs-admin.md): retry, bulk re-run, schedule/edit/cancel a job, purge by state.

Sandbox and code

- [Terminal](./terminal.md) [`--sandbox`]: tabs, typing, re-attach, keys panel, full screen, close.
- [Computer](./computer.md) [`--sandbox`]: desktop, VNC live view, control, Apps menu, reset.
- [Browser](./browser.md) [`--sandbox`]: `/browser` page and the chat panel from `/browse N`, desktop and phone.
- [Code](./code.md) [`--shelley`]: Shelley threads: start, steer, queue, stop, changes, the grouped thread list (fold, New thread per group, Archived footer view), Code settings, bot hand-off.
- [Code multi-select archive](./code-select.md) [`--shelley`]: Select threads, archive or restore many at once, one Undo.
- [Code extras](./code-extras.md) [`--shelley`]: fork, change directory, worktree, repository groups, chips, completions, uploads, usage, queued actions, recover.
- [Code comments](./code-comments.md) [`--shelley`]: folded diff context, a line comment under its line, waiting above the composer, sent with the next message.
- [A bot's own browser and computer](./bot-profiles.md) [`--sandbox`]: own profile, start, stream, reset, release on delete.
- [Claude plan](./claude-plan.md): the engine-off state.

## A full pass

Run `../scripts/full-pass.sh` (it refuses to start if a journey is missing from its groups). The shared sandbox and the empty-database setup need their own instances, and parallel groups finish sooner, so it runs these in parallel (the auth rate limit is lifted on every run: `up` sets `AUTH_RATE_LIMIT_MAX=1000`):

1. Three plain runs on spaced ports, each driving about a third of the non-sandbox journeys.
2. One `up --sandbox --shelley` run for terminal, computer, browser, code and claude-plan.
3. One `up --empty` run for setup.

Every journey is expected to pass; a failure is a regression or a new bug.

## Regression checks for fixed bugs

These steps caught real bugs in the 2026-11 pass; the bugs are fixed and the steps now guard against regressions:

- `vault` (#164): a wrong step-up password is refused with 403 and the owner stays signed in.
- `chat-attachments` (#165): the enlarged image viewer covers the window and closes.
- `command-palette`, `account-shell` (#166): ⌘K lists each destination once and nothing unconfigured.
- `bot-to-bot` (#167): `+` → `Mention a bot` opens the mention list.
- `storage` (#168): View shows UTF-8 text correctly.
- `jobs` (#169): job rows and toast links open the job.
- `terminal` (#170): CSS full screen (no Fullscreen API) can be left from inside the region.
- `claude-plan` (#171): with the engine off, the card never claims there is no sandbox.
- `storage`, `jobs` (#172): no `<li>` nested in `<li>` in `result.json` `consoleErrors`.
- `bot-profiles` (#173): deleting a bot closes and wipes its own desktop, not only its browser.
- `vault-passkey` (#174): a passkey the server doesn't know is refused with 403 and the owner stays signed in.

## Unreachable here (prerequisite)

- Real model behaviour: tools the faux model can't call (`run_command`, `computer_*`, MCP tools, `remember`/`forget`, vault fill, `message_bot`), background memory capture, model-written chat titles, vision input. Needs a real provider.
- Auto-review approvals: a Cloudflare AI Gateway classifier, and the faux runtime passes no reviewer.
- Claude Code sign-in and harness: a Claude plan account (Settings → Models) plus a real Claude Pro/Max login.
- Real push delivery, Send test, delivery log: Pushover keys (never in a verification run).
- Connection OAuth sign-in, skill import from GitHub: external services.
- Feedback submission: an external service.
