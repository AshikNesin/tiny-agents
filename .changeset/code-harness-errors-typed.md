---
"@tiny-agents/code": patch
---

Claude Code on the Code page: a bad request is answered as one (register row C13).

- **400:** a missing or unusable working directory, an unknown effort or permission mode, an empty title and the like answer 400 with the reason ("Unknown effort "extreme". Use one of: low, medium, high, xhigh, max.") instead of 500 "unexpected error".
- **404:** a Claude Code thread that does not exist answers 404 ("No Claude Code thread …"), so a bot's `code_send` or `code_status` on it says there is no such thread.
- **Unchanged:** anything the harness did not expect, such as the sandbox worker being unreachable, is still a 500.
