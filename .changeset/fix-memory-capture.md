---
"@tiny-agents/agent": patch
"@groot/web": patch
---

Fix memory capture discarding short preferences: use a 24-byte owner-text threshold, the bot's own model instead of a hardcoded gateway model, assistant context, and today's date. Preserve the watermark and log returned model errors. Exclude peer/routine exchanges from capture.

Add an approval-gated `remember` tool for immediate chat-side saves. Saves share background capture's transaction, dedupe (including deleted memories), and budget without advancing its watermark. Existing read-only memory adapters remain compatible.
