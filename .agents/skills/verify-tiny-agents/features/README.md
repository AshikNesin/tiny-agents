# tiny-agents verification map

This directory is the maintained source for verifying the user-facing behavior of tiny-agents. Read the index before driving the app, then use the matching feature file as the recipe. Every feature has a journey in `../journeys/` that runs the recipe end to end.

## Baseline preconditions

- A run started with `ta-verify up` (default `http://localhost:3100`), seeded with only the demo user `demo@example.com` / `demo@example.com`.
- Faux model on (`TINY_AGENTS_FAUX=1`): bots reply `Echo: <message>`, the model picker offers `Test Model (faux)`. Scripted triggers: `/ask` (question cards), `/browse N` (browser tool rounds), `/code [cwd=PATH] task` (coding hand-off), `/improve` and `/improve long` (instruction-change approval).
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
- [Account and shell](./account-shell.md): account menu, theme, sidebar rail, People tab, phone layout.
- [Command palette](./command-palette.md): ⌘K open/close, search, navigation and actions.
- [App settings](./settings.md): create, edit, persist and delete a JSON setting.
- [Notifications](./notifications.md): not-configured state, event settings, attention badges and tab title.

Chats

- [Chats with bots](./chats.md): create a bot, streamed reply, reload, New chat, Chat history.
- [Past chats](./past-chats.md): titles, read-only view, continue, delete.
- [Chat attachments](./chat-attachments.md): images and text files, image-only sends, refused uploads.
- [Message steering](./message-steering.md): steer, queue, withdraw and stop while a reply streams.
- [Questions for the owner](./questions.md): `/ask` cards, answers, skip, dismiss.
- [Bot settings](./bot-settings.md): edit dialog, unique names, pin, delete.
- [Tool permissions](./tool-permissions.md): Allow/Ask/Off, approval cards, always allow.
- [YOLO mode](./yolo.md): confirm, banner, auto-approval, off on New chat.
- [Self-improvement](./self-improve.md): `/improve` approval, Read more, the prompt really changes.
- [Auto-review](./auto-review.md): the switch and its no-classifier behaviour.
- [Bot-to-bot](./bot-to-bot.md): `@` mentions and relayed peer replies.
- [Shared bots and guests](./shared-bots.md): guests, sharing, what a guest can and can't reach.
- [Memory](./memory.md): `/memory` add, edit, search, learning switch, delete.

Work

- [Tasks](./tasks.md): quick add, edit, complete, reopen, delete.
- [Routines](./routines.md): schedule preview, paused routine, Run now, the quiet chat line.
- [Skills](./skills.md): create, edit, attach to bots, import, delete.
- [Connections (MCP)](./connections.md): against a real local MCP server the journey starts.
- [Vault](./vault.md): every item kind, step-up, masking, reveal, policy, delete.
- [Model providers](./model-providers.md): catalog and picker with no provider keys.
- [Storage](./storage.md): folders, byte-exact upload/download, rename, bulk delete.
- [Jobs](./jobs.md): list, filters, detail, cancel/resume, re-run, delete.

Sandbox and code

- [Terminal](./terminal.md) [`--sandbox`]: tabs, typing, re-attach, keys panel, full screen, close.
- [Computer](./computer.md) [`--sandbox`]: desktop, VNC live view, control, Apps menu, reset.
- [Browser](./browser.md) [`--sandbox`]: `/browser` page and the chat panel from `/browse N`, desktop and phone.
- [Code](./code.md) [`--shelley`]: Shelley threads: start, steer, queue, stop, changes, archive, bot hand-off.
- [Claude plan](./claude-plan.md): the engine-off state.

## A full pass

The auth rate limit and the shared sandbox mean one instance can't drive everything:

1. Three plain runs on spaced ports, each driving about a third of the non-sandbox journeys.
2. One `up --sandbox --shelley` run for terminal, computer, browser, code and claude-plan.
3. One `up --empty` run for setup.

Expected failures are listed under Known product bugs; anything else failing is new.

## Known product bugs (journeys assert the correct behaviour)

- `vault`: a wrong step-up password signs the owner out (the step-up 401 hits the shell's global 401 handler).
- `chat-attachments`: the enlarged image viewer is clipped to its message row and Download covers Close.
- `command-palette`, `account-shell`: ⌘K lists Navigation, Theme and Account twice (shell groups plus the app's), including `Code` when no coding agent is configured.
- `bot-to-bot`: `+` → `Mention a bot` inserts `@` but focus returns to `+`, so the mention list never opens.
- `storage`: View shows UTF-8 text garbled (`text/plain` without a charset).
- `jobs`: every in-app link to a job goes to `/jobs/<id>`, a route that isn't mounted.
- `terminal`: CSS full screen (no Fullscreen API, e.g. iPhone Safari) covers the header, so it can't be exited.
- `claude-plan`: with the engine off, the card says no sandbox is configured even when one is.

## Unreachable here (prerequisite)

- Real model behaviour: tools the faux model can't call (`run_command`, `computer_*`, MCP tools, `remember`/`forget`, vault fill, `message_bot`), background memory capture, model-written chat titles, vision input. Needs a real provider.
- Auto-review approvals: a Cloudflare AI Gateway classifier, and the faux runtime passes no reviewer.
- Claude Code sign-in and harness: `CLAUDE_CODE_ENGINE_ENABLED=1` plus a real Claude Pro/Max login.
- Real push delivery, Send test, delivery log: Pushover keys (never in a verification run).
- Connection OAuth sign-in, skill import from GitHub, 1Password vault items: external services.
- Feedback submission: an external service.
