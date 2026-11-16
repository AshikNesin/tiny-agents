# Code comments

Reviewing a Code thread's changes as a reviewer does: the Changes panel folds unchanged runs into `Show N more lines`, each line's gutter offers a Comment button that opens a composer right under the line, a saved comment stays under its line and waits above the thread's composer, and the next message carries it to the agent, where the thread shows it as a comment card.

## Sub-features

- `code-diff-fold` unchanged runs longer than three lines either side of a change fold into a button `Show N more lines`.
- `code-line-comment` a line's gutter button `Comment on line N` (`Comment on removed line N` for a removed line) opens a textbox `Comment on <path> line N` (placeholder `Tell the agent what to change here…`) with `Cancel` and `Comment` (⌘↵); shift-click widens the range (`Commenting on lines A–B`).
- `code-comment-saved` a saved comment is a `note` named `Comment on line N` under its line, with `Remove comment`.
- `code-comment-tray` region `Comments for the agent` above the composer: `N comment(s) go(es) with your next message`, `Show comments` / `Hide comments`, `Send now`, `Remove comment` per comment.
- `code-comment-sent` the next message takes them along: the tray goes, the transcript shows an `article` per comment (`<path>:<lines>`, the quoted lines, the comment) and then the message.
- `code-review-page` each side pane's `Open as a page` opens `/code/<id>/review` (`code-review-page`): tabs `Changes` and, for a project thread, `Pull request #N` (`?tab=pr`), at full width; comments work there and wait in the tray at the bottom; link `Back to the thread`.
- `code-sidebar` `Hide sidebar` (top of the thread list, ⌘B) folds the `complementary` `Threads` away (`data-state="closed"`); `Show sidebar` (top left, `aria-expanded` false) brings it back.
- Not driven: the Review panel of a project thread (needs GitHub), a guest's comment going into the composer, `Send now` (covered by `tests/client/pages/code-pending-comments.test.tsx`), the PR chip on rows (needs a project's PR).

## How to get to it (user POV)

- `/code` → a thread → `Changes` (⌘⇧D) → hover a line → its `+`.

## Driving it with ta-verify

Preconditions: `ta-verify up --shelley` (the journey requires `shelley`).

- **Setup.** `setup:` a throwaway git repo `data/verify/<run>/work-<stamp>` with `src/app.ts` (60 lines, committed), then line 30 changed on disk (uncommitted). Cleanup deletes every thread in that dir and the dir.
- **Start.** `/code/new` → `Working directory` = the repo → `echo: review-<stamp>` → `Start`.
- **Fold.** `Changes`: one `code-file`; `Show 26 more lines` and `Show 27 more lines`; `const line10 = 10;` not shown.
- **Comment.** Hover line 30 → `Comment on line 30` → textbox focused → type → `Comment`: POST `/review/drafts` 201, a `note` `Comment on line 30`, the tray reads `1 comment goes with your next message`, `Show comments` lists `src/app.ts:30`; the API lists the draft.
- **Send.** `echo: thanks-<stamp>` + Enter: the tray goes, an `article` with `src/app.ts:30` and the comment, then `echo: thanks-<stamp>`; no `note` left; the API lists no drafts.
- **Review page.** `Open as a page` in Changes: URL ends `/review`, tab `Changes` selected, one `code-file`, no transcript; a comment on line 30 there shows in the page's tray; `Back to the thread`: the thread's tray reads `1 comment…`.
- **Sidebar.** `Hide sidebar`: `Threads` closed, `Show sidebar` visible; `Show sidebar`: open again.
- **Proof.** `ta-verify drive $S/journeys/code-comments.mjs` → `code-comments/changes-folded`, `composer-inline`, `comment-waiting`, `comment-sent`, `review-page`, `sidebar-hidden`.

## Gotchas

- The gutter `+` shows on hover only (opacity); hover the line first so the screenshot shows it.
- The predictable model answers the combined message with its default reply; the proof is the user turn, not the answer.
