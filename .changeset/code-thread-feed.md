---
"@tiny-agents/code": minor
---

Harness drivers share one `ThreadFeed` (`@tiny-agents/code/server`) for the
watch-thread protocol: a watcher's snapshot comes first, then only the rows
that changed for it, the streaming text is re-sent after a snapshot while a
turn runs, and a failing listener never stops the others. Drivers hand it
full row lists and state; `ItemTracker` is gone (the feed diffs). The test kit
adds `threadEventProblems(events)`, which checks any driver's watch output
against the same rules.

Shelley now starts its watchers over from a fresh snapshot after its stream
reconnects (it used to send only the changed rows), so rows that disappeared
while it was down go too, and a turn that ended meanwhile leaves no stale
streaming text. The normalizers share `pick`, `isImageFile` (png, jpeg, gif,
webp, avif and svg show inline for both harnesses) and the harness-neutral
`lastAnswer(items)`.
