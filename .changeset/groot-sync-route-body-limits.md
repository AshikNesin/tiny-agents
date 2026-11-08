---
"tiny-agents": patch
---

Synced groot `2a63753` (AshikNesin/groot#167): `routeBodyLimit()` can word its own 413. The upload and Code upload routes now own their body limits with it, keeping their "25 MB" messages, and tiny-agents no longer uses the deprecated `uploadPaths` option.
