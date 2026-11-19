# Code pull requests

A project thread's pull request from start to merge: the thread gets its own worktree and branch, Publish pushes it and opens a draft PR, the Pull request tab follows its checks and comments, Draft, Auto-merge and Merge act on GitHub, the PR tab's Review opens review mode, the Reviews inbox offers Add project for a repository outside any project, and a merge that archives the thread leaves its PR tab leading with the merged PR.

## Sub-features

- `code-project-thread` `/code/new?project=<id>`: a thread starts in its own worktree; the transcript's first row reads `ta/<slug> from main`.
- `code-publish` the PR tab before a PR: `Branch … is N commit(s) ahead of main.` with Refresh, `Publish draft PR` (`code-publish`) and `Link pull request`; no header repeating the tab's name.
- `code-pr-tab` with a PR: `#N`, its state, title and `head → base`; checks with the failing one first (`N failing check`, Fix CI); `Merge` (disabled while a draft); switches `Auto-fix` (`code-autofix`), `Draft` (`code-draft`), `Auto-merge` (`code-automerge`, `On at GitHub`); Fix only with open comments or a conflict; Spend limit and the Auto-fix status only while Auto-fix is on; region `Comments` only once there are some, with `Auto-fix skips` marks only while Auto-fix is on.
- `code-pr-review` the PR tab's `Review` opens `/code/reviews/<id>` on the PR's files.
- `code-reviews-add-project` a Reviews inbox row from a repository that is not a project has a link `Add <repo> as a project to review #N here` to Code settings' Projects section with `?repo=<repo>`, which fills Add a project's `Repository`.
- `code-merged` Merge → `Squash and merge`: region `Merged` with `#N`, no Publish; the composer reads `Unarchive to continue` (`code-archived`); Source control says `Its worktree went when the thread was archived…`.
- Not driven: Auto-fix passes (they need a harness turn that fixes something), Fix CI, check logs (covered by `tests/client/pages/code-pr-panel.test.tsx`), the GitHub App transport, webhooks.

## How to get to it (user POV)

- `/code` → New thread → pick a project → send → `Review` in the header → `Pull request`.
- `/code/reviews` for the inbox.

## Driving it with ta-verify

Preconditions: `ta-verify up --shelley --fake-github` (the journey requires both). `--fake-github` boots the server through `scripts/fake-github-entry.ts`: Code's GitHub client is the server tests' in-memory fake (`tests/server/code/projects/fake-github.ts`) and git runs locally against a bare `acme/web`. A control server on port + 3 shapes it: `GET /state`, `POST /pulls/<n>` (merge fields: `checks`, `reviews`, `threads`, `mergeable`…), `POST /inbox`.

- **Setup.** `setup:` a project on `acme/web` through the API, named `web-<stamp>`. Cleanup deletes its threads (live and archived) and the project.
- **Start.** `/code/new?project=<id>` → `echo: start-<stamp>` → the thread's URL; `ta/… from main`.
- **Commit.** `bash: … git commit …` as the second message (the project preamble prefixes the first, so `bash:` only works from the second); `now at <sha>`.
- **Publish.** PR tab → `Publish draft PR`: `Draft` checked, the fake's PR is a draft, Merge disabled, no Fix, no Comments, no Spend limit.
- **Checks.** Control sets lint/test/build → Refresh → `1 failing check`.
- **Switches.** Draft off, Auto-merge on: `On at GitHub`; the fake's PR is ready with auto-merge.
- **Review.** Control adds carol's CHANGES_REQUESTED review → region `Comments` shows it, no `Ignored`/`Auto-fix skips` mark.
- **Review mode.** PR tab `Review` → `/code/reviews/<id>` with `b.ts` listed.
- **Inbox.** Control sets an `acme/api` PR → `/code/reviews` → `Add acme/api as a project…` → Code settings' Projects section with `?repo=acme%2Fapi`, `Repository` = `acme/api`.
- **Merge.** Control turns checks green → `Merge` → `Squash and merge`: region `Merged` with `#N`, no Publish, the fake recorded the merge, `code-archived` shows; Source control explains the worktree.
- **Proof.** `ta-verify drive $S/journeys/code-pr.mjs` → `code-pr/thread`, `pr-tab-before`, `published`, `checks`, `review-comment`, `review-mode`, `add-project`, `merged`, `merged-source`.

## Gotchas

- The fake keeps its PRs for the life of the run: each drive opens the next number. Read it from `GET /state`, never assume `#1`.
- The predictable Shelley's commits need an identity: pass `git -c user.email=… -c user.name=…`.
- Titles are the task's words here (faux mode has no naming model).
