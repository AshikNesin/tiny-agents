# Architecture Decision Records

ADRs record _why_ a decision was made — not what the code does. They are
written once, never edited (except status changes), and superseded rather
than deleted, so future sessions (human or AI) can reconstruct the reasoning
that the code alone cannot show.

## Conventions

- File naming: `NNNN-short-slug.md` (sequential, zero-padded).
- Structure: Status / Context / Decision / Consequences (+ Alternatives
  considered, links to related ADRs).
- Status is one of: `proposed`, `accepted`, `superseded by NNNN`, `reverted`.
- New ADRs are appended by number; supersedence is recorded in _both_ records.

## Index

0020 is reserved for the native Code harness on pi-durable (issue #297,
phases 0 and 1), which follows the PR loop.

| #    | Title                                                                                                                | Status                                              |
| ---- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 0001 | [Own the DLS on the shadcn stack, Kumo as reference](0001-own-dls-on-shadcn-stack.md)                                | accepted (reinstated by 0003)                       |
| 0002 | [Adopt @cloudflare/kumo directly](0002-adopt-kumo-directly.md)                                                       | reverted by 0003                                    |
| 0003 | [Revert Kumo adoption; reinstate own DLS](0003-revert-kumo-adoption.md)                                              | accepted                                            |
| 0004 | [Every bot has every built-in toolkit](0004-every-bot-has-every-toolkit.md)                                          | accepted                                            |
| 0005 | [Secrets bots use live outside the app](0005-secrets-live-outside-the-app.md)                                        | accepted (amended by 0015, 0017)                    |
| 0006 | [The computer is a desktop on the sandbox VM](0006-computer-is-a-desktop-on-the-sandbox-vm.md)                       | accepted                                            |
| 0007 | [A local sandbox container for machines off the tailnet](0007-local-sandbox-container.md)                            | accepted                                            |
| 0008 | [Claude subscription inference goes through Claude Code](0008-claude-code-engine.md)                                 | accepted (amended by 0010, 0014, 0016, 0018)        |
| 0009 | [Coding goes to Shelley; tiny-agents is a client of its API](0009-shelley-is-the-coding-agent.md)                    | accepted (generalized by 0011)                      |
| 0010 | [The Claude worker runs on the sandbox, set up by the app](0010-claude-worker-runs-on-the-sandbox.md)                | accepted (amends 0008; amended by 0013)             |
| 0011 | [The Code page talks to coding agents through harness adapters](0011-code-harness-adapters.md)                       | accepted (generalizes 0009)                         |
| 0012 | [Claude Code's coding mode on the sandbox worker](0012-claude-code-coding-mode.md)                                   | accepted (amends 0008)                              |
| 0013 | [One sandbox connection](0013-one-sandbox-connection.md)                                                             | accepted (amends 0010)                              |
| 0014 | [One Tool gate for both engines, behind a real AgentEngine seam](0014-tool-gate-and-engine-seam.md)                  | accepted (amends 0008; amended by 0016, 0018)       |
| 0015 | [One secrets subsystem: the vault holds the app's own credentials too](0015-one-secrets-subsystem.md)                | accepted (amends 0005; amended by 0019)             |
| 0016 | [Models are owner data](0016-models-are-owner-data.md)                                                               | accepted (amends 0008, 0014)                        |
| 0017 | [Local is the only vault backend](0017-local-is-the-only-vault-backend.md)                                           | accepted (amends 0005; amended by 0019, 0027)       |
| 0018 | [Claude plan transcripts are durable entries](0018-claude-plan-transcripts-are-durable-entries.md)                   | accepted (amends 0008, 0014)                        |
| 0019 | [Vault values live in a table, opened under their row's policy](0019-vault-values-table.md)                          | accepted (amends 0015, 0017)                        |
| 0021 | [Code projects: a repository on the sandbox, a worktree per thread](0021-code-projects-and-worktrees.md)             | accepted (amends 0012; amended by 0025)             |
| 0022 | [GitHub through `gh` or a vault token; the app publishes](0022-github-through-gh-or-a-token.md)                      | accepted (amends 0015)                              |
| 0023 | [Auto-fix: a pure decision, claimed passes, explicit trust and limits](0023-auto-fix.md)                             | accepted                                            |
| 0024 | [The GitHub App transport, auto-merge, checkpoints and the rest of phase 6](0024-code-github-app-and-checkpoints.md) | accepted (amends 0021, 0022, 0023; amended by 0025) |
| 0025 | [Steady diffs: one git reader, plumbing reads, pushed change versions](0025-steady-code-diffs.md)                    | accepted (amends 0021, 0024)                        |
| 0026 | [Web Push is the push transport; the server holds no provider credentials](0026-web-push-transport.md)               | accepted                                            |
| 0027 | [1Password Connect comes back, and runs inside the app's container](0027-1password-connect-runs-inside-the-app.md)   | accepted (amends 0005, 0017)                        |
| 0028 | [Code carries no comments; decisions live in ADRs](0028-code-carries-no-comments.md)                                 | accepted                                            |
| G4   | [Hono + Drizzle on SQLite, for Node and Cloudflare Workers](0004-hono-drizzle-sqlite-workers.md)                     | accepted (groot)                                    |

`G4` is groot's ADR 0004, synced from the boilerplate; tiny-agents' own 0004
predates it. tiny-agents runs on Node only (Chromium, ssh2, the agent store),
so the Workers half of G4 does not apply here.
