# Claude plan and the Claude Code harness

Settings → Claude plan tells the owner whether bots can answer on their Claude subscription through Claude Code on the sandbox, and offers `Sign in to Claude`, which opens a terminal tab running `claude auth login`. With the engine on and a sandbox, `/code` also offers Claude Code as a coding harness beside Shelley. In a verify run the engine is off and no Claude account exists, so only the engine-off state is reachable.

## Sub-features

- `claude-plan-off` Settings tab `Claude plan`: engine line (`The engine is off. Set CLAUDE_CODE_ENGINE_ENABLED=1 …`), no account line (`claude-plan-account` appears only with the engine on, #171), fallback line (`turns pause.`), the never-paste-a-token note.
- `claude-plan-sign-in` `Sign in to Claude` / `Sign in again` (`claude-plan-sign-in`) opens `/terminal?tab=<name>` running `claude auth login`. Unreachable: needs `CLAUDE_CODE_ENGINE_ENABLED=1`.
- `claude-plan-installing` `Installing Claude Code on the sandbox…` and `Claude Code is installed but not signed in…`. Unreachable: needs the engine on.
- `claude-plan-signed-in` `Signed in to Claude (<plan>). Ready to use.` and bots answering on a "uses your Claude plan" model. Unreachable: needs a signed-in Claude Pro/Max account on the sandbox.
- `code-claude-harness` `/code` harness picker (`code-harness`), Claude Code threads (Accept edits, permission chip, approval and question cards). Unreachable: needs the engine on and a signed-in account.

## How to get to it (user POV)

- Account menu → Settings (`/settings`) → tab `Claude plan`.
- `/code/new` → harness picker (only when both Shelley and Claude Code are configured).

## Driving it with ta-verify

Preconditions:

- `ta-verify up --sandbox` (journey requires `sandbox`; with `--shelley` it also checks `/code`). `ta-verify` blanks `CLAUDE_CODE_ENGINE_ENABLED`, and no Claude credentials exist in a verify run.

- **Engine off.** `GET /api/v1/claude-code/status` → `enabled: false`, `fallback: "pause"`.
- **Card.** `/settings` → tab `Claude plan`: the engine-off line, `turns pause.`, the token note; no `claude-plan-account`; no `claude-plan-sign-in` button.
- **Code.** With `shelley`: `/code/new` has no `code-harness`; `GET /api/v1/code/status` harness ids are exactly `["shelley"]`. Without it: no `Code` link in `Primary`.
- **Account line.** With the engine off there is no `claude-plan-account` line at all, and with a working sandbox (`GET /api/v1/terminal/sessions` status `ready`) the card must not say `No sandbox is configured` (regression check for #171).
- **Proof.** `ta-verify drive $S/journeys/claude-plan.mjs` → `claude-plan/settings-engine-off`, `code-no-claude-harness`.
- **Unreachable** (record, do not claim): sign-in, install progress, signed-in state, Claude plan bot turns and the Claude Code harness. Prerequisites: a `ta-verify up` option that sets `CLAUDE_CODE_ENGINE_ENABLED=1` with `--sandbox` (reaches install, not-signed-in, `Sign in to Claude` → terminal `claude auth login` prompt, harness picker) plus a real Claude Pro/Max sign-in for everything after that.

## Gotchas

- Regression check for #171 (fixed 2026-11): with the engine off, `GET /api/v1/claude-code/account` answers `unconfigured` (no worker is wired), which the card used to render as `No sandbox is configured` even with a working sandbox. The account line now shows only while the engine is on.
- The model catalog still lists the three `claude-code/*` models ("uses your Claude plan") with the engine off; a bot on one pauses (`fallback: "pause"`). Do not pick them for faux journeys.
