# 0022 — GitHub through `gh` or a vault token; the app publishes

- Status: accepted (amends [0015](0015-one-secrets-subsystem.md): a new `github` sink)
- Date: 2026-11-16
- Design: issue #297 (revision 3), phase 3, open questions 2 and 3

## Context

Code needed to open pull requests, read checks and reviews, and answer
review threads. A GitHub App cannot always be installed, and nothing in the
loop needs one.

## Decision

- **One client** (`packages/github`, `GitHubClient`) over two transports.
  Projects, the PR tab and Auto-fix see only the client.
  - **`gh` on the sandbox** (the default when no token is set): `gh api`
    through an exec port, signed in with `gh auth login` from the Terminal
    page. Request bodies go on stdin.
  - **HTTPS with a token** (recommended): API calls from the app server with
    a token from an `app` vault item, so no GitHub credential sits on the
    sandbox for API calls. Only `git push` and fetches run there, with the
    token handed to that one command on stdin.
- **A new vault sink, `github`.** An `app` item that lists `github.com` or
  `api.github.com`, used only by Code (`resolveGitHubToken`). Settings →
  GitHub stores it; the owner configured it, so no approval card.
- **`packages/github` imports neither pi-durable, `@tiny-agents/agent` nor
  `@tiny-agents/sandbox`** (lint R11): the `gh` transport takes an exec port.
- **The app publishes.** Pushing, opening the draft PR, replying to review
  threads and resolving them are operations the app runs, for every
  harness and transport. Push rules: never forced (a pass merges the base in
  rather than rebasing, and git rejects a push if the remote moved); hooks
  off and an explicit remote URL; a pass may not push changes to protected
  paths (`.github/workflows/**` by default); only commits are pushed.
- **PR links** (`code_pull_requests`): a thread may have several PRs over
  time, at most one open. A link is made on Publish, by Link pull request,
  or by branch match when the PR tab opens or a turn ends (a PR the agent
  opened itself). GitHub is the source of truth; the row is its cache.
- **Pull first.** A chained delayed job per open PR (`code-pr-reconcile`)
  fetches one GraphQL snapshot and acts on it; each run queues its
  successor (60 s while checks move or after a push, 5 minutes idle, 30
  minutes when every pending check has stalled for 6 hours). The chain's
  link is stored on the row and moved by compare-and-set, so a duplicate run
  never forks it; boot re-arms any chain whose link is gone. Opening the PR
  tab reconciles at once.

## Consequences

- With `gh auth login`, the login is in the sandbox user's home: every
  process there can use it. With a token, exposure is one command's
  environment for its duration. Neither is a boundary inside the sandbox.
- A pass or a review starts one to three minutes after GitHub reports it on
  polling. The App transport and webhooks are phase 6.

## Alternatives considered

- GitHub App only: cannot always be installed.
- The agent runs `gh` for everything: no check before a push, and an
  injected instruction reaches whatever the credential can.
- Force-push with a lease: nothing needs to rewrite history.
