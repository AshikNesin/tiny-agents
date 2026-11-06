# tiny-agents verification map

This directory is the maintained source for verifying the user-facing behavior of tiny-agents. Read the index before driving the app, then use the matching feature file as the recipe. Every feature has a journey in `../journeys/` that runs the recipe end to end.

## Baseline preconditions

- A run started with `ta-verify up` (default `http://localhost:3100`), seeded with only the demo user `demo@example.com` / `demo@example.com`.
- Faux model on (`TINY_AGENTS_FAUX=1`): bots reply `Echo: <message>`, the model picker offers `Test Model (faux)`.
- No sandbox VM (`SANDBOX_HOST` empty), no AI provider keys, no `SECRETS_KEY`.
- `ta-verify doctor` exits 0 before the first drive and after any failed drive.
- Never drive an instance this run did not start.

## Driving conventions

- Start every recipe from the baseline state plus a signed-in demo user (`journey()` signs in unless `{ signIn: false }`).
- ARIA roles and accessible names first; `data-testid` only where the app ships one.
- Every name a recipe creates carries the drive's `stamp`; register `cleanup()` right after creating it.
- Setup through the API is allowed only for state that is not the feature under test (e.g. a bot for a routine). Say so in the step name (`setup: …`).

## Proof and skip reporting

- `proof(label)` after each meaningful state change: screenshot + ARIA snapshot under `data/verify-evidence/<run>/<feature>/`.
- Mutations are confirmed by a second view: reload, another tab, or the row read back through `api`.
- Record unreachable paths with the attempted route and the unmet prerequisite. Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 and one paragraph of user-visible behavior, then exactly four H2s in order: `Sub-features`, `How to get to it (user POV)`, `Driving it with ta-verify`, `Gotchas`. Keep implementation details out; name user paths, stable handles, required state, commands and observable proof.

## Features

- [Sign in and out](./auth.md) covers the login form, the wrong-password error, the account-menu logout and the protected-route redirect. Journey: `auth.mjs`.
- [Chats with bots](./chats.md) covers creating a bot, a streamed reply, reload persistence, New chat and Chat history. Journey: `chats.mjs`.
- [Tasks](./tasks.md) covers quick add, editing, completing, reopening and deleting a task. Journey: `tasks.mjs`.
- [Routines](./routines.md) covers the schedule editor preview, a paused routine, Run now and its quiet chat line. Journey: `routines.mjs`.
- [App settings](./settings.md) covers creating, editing, persisting and deleting a JSON setting. Journey: `settings.mjs`.

## Not yet mapped

User-facing surfaces present in `apps/web/src/client/App.tsx` without a feature file yet. Add one (and a journey) before claiming coverage:

- `/terminal`, `/computer`, `/browser`: need a sandbox VM (`SANDBOX_HOST`, `pnpm sandbox:up`); unreachable in the baseline.
- `/code`: needs Claude Code installed and signed in on the worker; unreachable in the baseline.
- `/vault`: adding a local item needs `SECRETS_KEY`.
- `/connections` (MCP servers), `/skills`, `/memory`, `/storage`, `/jobs`, `/setup` (first-run, only with an empty user table): reachable, not yet mapped.
- Chats sub-features covered by `tests/e2e` but not this map: attachments, questions, tool permissions, yolo mode, bot-to-bot.
