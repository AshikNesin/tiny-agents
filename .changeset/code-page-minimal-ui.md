---
"@groot/web": minor
---

Code page: a minimal UI modelled on Cursor's cloud agents and Claude Code on
the web. Model, reasoning, working directory, repository and diff pickers
are searchable (`SearchSelect`, type to filter); the model, reasoning and
context ring live in the composer, whose send button becomes Stop while
Shelley works; the header is one line with the actions in the title's menu;
a run of finished tool calls folds into one "Ran 3 commands, edited 2 files"
line; the list is one line per conversation; Changes stacks every changed
file's diff in one scroll. Archive (on a row's hover, or the header) moves a
conversation with all its subagents — `POST /shelley/conversations/:id/archive`
and `/unarchive` now cascade to descendants and answer `subagents` — with Undo.
Phones get a real new-conversation screen at `/code/new`.
