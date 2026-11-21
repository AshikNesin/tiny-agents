---
"tiny-agents": patch
"@tiny-agents/agent": patch
"@groot/core": patch
"@groot/shell": patch
"@groot/ui": patch
---

Client and server now share one copy of the rules they used to mirror: the question answer limit and the skip-reply marker (`@tiny-agents/agent/wire`), the routine schedule math (`apps/web/src/shared/routines-schedule.ts`) and the login and setup form schemas. Storage folders report `lastModified: null` instead of a 1970 date. `Layout` takes `chrome={false}` to drop its sidebar and mobile bar, and `Form` and `FormField` type their resolver and bound input without casts.
