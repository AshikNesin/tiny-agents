---
"@groot/ai": patch
"@groot/core": patch
"@groot/jobs": patch
"@groot/shell": patch
"@groot/ui": patch
"@tiny-agents/agent": patch
---

Bump dependencies, including `@earendil-works/pi-durable`, `pi-ai`, and `chord` to 1.4.0. Document definitions pass `checkpointWhen: () => false` so ordinary changes stay deltas. Sentry 11, files-sdk 3, and SimpleWebAuthn 14 needed small call-site updates.
