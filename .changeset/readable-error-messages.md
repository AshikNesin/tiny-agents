---
"@groot/web": patch
---

Errors now say what went wrong. Toasts and inline errors across the app
(bot dialog, skills, tasks, chat, browser panel, attachments, vault) showed
axios's "Request failed with status code 400/409" instead of the server's
reason. A shared `errorMessage()` helper now shows the first validation
message (for example "System prompt is too long (max ~24 KB)"), then the
server's message, and plain words when the server could not be reached. The
system prompt field also stops at the 24 KB limit and shows a counter near it.
