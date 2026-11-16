---
"tiny-agents": patch
"@tiny-agents/claude-worker": patch
"@tiny-agents/code": patch
---

Code's Changes and Review panels are steady while an agent works, on the local sandbox container or over SSH.

- **Right files, right counts.** A new file the agent has not committed shows up, a renamed file counts its lines on both sides, and a path with spaces or non-ASCII characters no longer breaks the whole Review panel.
- **No lock fights.** Reading changes never rewrites the git index, so an agent's commit no longer fails with `index.lock` while a panel is open.
- **Honest diffs.** A binary or oversized file (over 2 MB) says so instead of showing garbage or a whole-file deletion; a very long diff draws its first 4,000 lines, and one too costly to work out says so instead of freezing the tab.
- **No blinking.** A re-read keeps the file list, what you folded and your scroll on screen; the open Review diff follows the file when the agent changes it again.
- **Live refresh.** While Changes is open, the server watches the directory's change stamp (one cheap git call every 1.5 s, slower once quiet) and the panel re-reads only when the files moved, on a steady beat even while the agent never pauses. Where a directory cannot be watched (Shelley), it re-reads on transcript activity as before.
- **Edit diffs survive a reload.** Claude Code threads redraw each Edit with its real hunks and line numbers after a reload or reconnect, read back from Claude Code's own session file.
