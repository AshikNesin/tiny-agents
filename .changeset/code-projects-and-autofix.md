---
"tiny-agents": minor
---

Code now takes a task from prompt to merged pull request. Add a GitHub repository as a project (Projects in the Code header), with a token kept in the vault or `gh` signed in on the sandbox. A thread started in a project gets its own worktree and branch. Changes compares with the base branch, with Viewed marks and line comments sent to the agent together. The new PR tab publishes a draft pull request and shows its checks, reviews and open comments, with Fix CI and Merge. Auto-fix keeps the pull request green while you are away: it fixes failing checks, trusted review comments and merge conflicts, pushes (never forced, never to CI workflow files), answers the reviewers, and stops at clear limits.
