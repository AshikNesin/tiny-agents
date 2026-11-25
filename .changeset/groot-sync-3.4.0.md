---
"tiny-agents": minor
---

Syncs the groot boilerplate from 3.2.1 to 3.4.0 (upstream commit a649c6d4). Brings in session logout by token version (sessions issued before a password change are refused), an `isAdmin` flag that gates the jobs API and jobs tooling, configurable PBKDF2 password iterations, jobs singleton rework (unique index per `name`+`singletonKey` with rerun support), the content-type-aware storage schema helpers, request-id logging, jose security fixes, and an updated lockfile. Local behavior is kept where it diverges: 600,000 password iterations, no R2 storage adapter, comment-free code, and file views that navigate to the download endpoint instead of a same-origin blob URL.
