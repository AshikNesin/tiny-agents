---
"@tiny-agents/agent": patch
"@groot/web": patch
---

Approval cards now say what the bot wants to do in plain words: "Chief wants to
open a page", "wants to delete a task", "wants to run a routine now", instead of
"wants to opened a page" built from the past-tense label the transcript shows
afterwards. Every built-in tool carries an imperative `askLabel` next to its
`label` in the capabilities API, and tools without one (connection tools) read
"wants to use <tool name>". The Always allow button's tooltip uses the same
wording.
