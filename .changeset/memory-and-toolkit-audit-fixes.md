---
"@tiny-agents/agent": patch
"@tiny-agents/sandbox": patch
"tiny-agents": patch
---

Memory capture no longer loses the oldest owner turns when a conversation backlog exceeds the 24,000-character window: the window now starts at the watermark and the watermark only advances past what was actually captured, so skipped messages are picked up by the next run.

The weekly memory tidy aborts without changing anything if a memory was edited during its model call, instead of overwriting the owner's edit with text derived from the stale snapshot.

Two concurrent `update_instructions` calls can no longer lose an append: the prompt revision and the new prompt are written in one transaction guarded by a conditional update, retried when another writer got there first.

A resumed `update_instructions` call now reports it was interrupted instead of appending the same lines a second time (its replay policy is `unsafe`, like other side-effecting tools).

`list_tasks` now returns only open tasks (`todo` and `in_progress`) when no status filter is passed, matching its description; pass `status: "done"` to see completed tasks.

A detached `run_command` under the egress allowlist keeps running past the call: it is started as its own transient systemd unit (egress-restricted, no runtime cap) instead of being killed with the wrapper the moment the call returns. Detached commands never accept secrets, as before.

tmux session geometry is validated as integers within the documented ranges before it is interpolated into the shell command, so no caller can smuggle a payload through cols or rows.

`search_attachment` with `regex: true` refuses patterns whose alternation under a quantifier is ambiguous (for example `(a|a)*`, `(a|aa)+$`, `((a|a)*)*b`), the classic catastrophic-backtracking shapes the nested-quantifier check missed. Benign alternations like `^(a|b)c$` still work.
