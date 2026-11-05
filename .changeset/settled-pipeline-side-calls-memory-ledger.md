---
"@groot/web": patch
---

Relay @mention and bot-to-bot replies that take real model time. Boot built
the Delivery answerer before the agent runtime had opened, so every relay
from a conversation's settling (and the boot sweep) failed against an
undefined runtime; only replies that finished before the submit returned
were relayed. The answerer is now built from the opened runtime.

Server internals behind it:

- `startSettledPipeline(runtime, { notifier, memoryCapture })` builds every
  Settled step from the opened runtime, in the glossary's order, subscribes
  once, resets the bot-to-bot per-turn budget, and runs each step's boot
  sweep after subscribing. Boot has one "settled conversations" part.
  Routine runs read only the settled conversation's awaiting rows.
- `createSideCaller(runtime)` runs memory capture and Past chat title calls:
  model choice, a deadline that aborts the call (a timed-out capture no
  longer keeps spending tokens), failure detection and logging in one place.
- `memoryLedger(botId)` applies the memory rules (dedupe, tombstones,
  supersession, expiry, budget, the capture watermark) to every write.
  Memory page adds now dedupe: adding text the bot already has returns that
  memory, and adding a removed or archived one brings it back instead of
  creating a second row. A restored memory is kept past a full budget
  instead of being archived again at once. Capture no longer lists expired
  memories as current, and only supersedes active ones.
