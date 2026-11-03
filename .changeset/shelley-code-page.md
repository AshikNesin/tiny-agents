---
"@tiny-agents/agent": minor
"@groot/web": minor
---

Add the Code page: a first-class workspace for the Shelley coding agent (issue #143).

`@groot/web` talks to Shelley's official HTTP/SSE API from the server only
(`SHELLEY_URL`, the only setting; requests carry `X-Exedev-Userid` for an
exe.dev Shelley's require-header guard): one
`/api/stream2` connection (`ShelleyHub`) feeds the live conversation list,
per-conversation streams, unread markers, Pushover pushes (`shelley.update`)
and bot hand-off finishes. `/api/v1/shelley/*` is a curated allowlist of
Shelley routes (lists, conversation, steer/queue/stop/retry/resume/fork,
settings, background jobs, `@` file search, skills, uploads, git diffs,
files and images). `/code` shows every conversation and subagent, a live
transcript with per-tool rows (live bash output, patch diffs, subagent
links, screenshots), the composer (steer, queue, `@` files, `/` commands,
attachments, skills), model and reasoning switching, a context meter, cost,
and a Changes panel with line comments. New tables `shelley_handoffs` and
`shelley_seen` (migration 0004).

`@tiny-agents/agent` adds the `shelley` toolkit (`shelley_start`,
`shelley_send`, `shelley_status`, `shelley_list`, `shelley_models`; no tools
without a store; start and send default to Allow via the new
`ToolInfo.allowByDefault`)
and `ChatToolCall.shelley`, the hand-off card a `shelley_start` result
carries.
