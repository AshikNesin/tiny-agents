# Memory

Per-bot long-term memory (issue #22): bots accumulate durable knowledge of the
owner, the owner sees and controls every byte of it, and capture never runs on
the reply path.

## Model

`Memory` rows in `app.db` (both engines), keyed to `botId` with cascade
delete. The domain object is a fact with a lifecycle, so the typed row makes
supersession, expiry, and the never-re-add tombstone structural:

- `category` — `preference | fact | goal | habit`
- `status` — `active | superseded | archived | expired | deleted`; only
  `active` ever injects
- `source` — `capture | manual` (the page's source line)
- `until` — optional expiry; expired rows stay rows, leave the prompt
- `supersededById/At` — strike-through chain when a newer fact replaces one

`Bot.memoryEnabled` gates capture, chat-side saves and forgets, and injection. `Bot.memoryCapturedThrough`
is the transcript watermark: capture commits it in the same transaction as
new rows, so a crash before commit re-runs the window harmlessly (exact-text
dedupe absorbs the repeat). Turning memory back on moves the watermark to
that moment, so nothing said while memory was off is ever captured.

Constants live in `memories.domain.ts`: 100 active rows, 300 chars per row,
a 6 000-char render cap on the injected block, a 24 000-char capture window,
the 30 newest deleted memories in the capture prompt, 2-minute quiet window,
6-turn trigger, 24-byte owner-text trivial threshold (UTF-8 bytes, excluding
role labels).

## Injection

The `memory` capability (`packages/agent/src/toolkits/memory.ts`) renders one
prompt section through the store-adapter pattern (`memories.store.ts`) with
`renderMemoryBlock`. Over the 6 000-char cap the newest memories (by
`createdAt`) win as whole lines, and the block ends with an accurate
`…N older memories omitted` line. The kept lines render in fixed category
order then createdAt ascending. Sections render before every request, and
pi-durable sends only what changed, so a saved, deleted or forgotten memory
reaches the prompt on the next message. It renders nothing when memory is off
or empty (zero prompt delta), and its content only changes when memories
change, so provider prompt caching survives between captures.

## Capture

`memories.capture.ts` + `memories.runner.ts`. An `onActivity` listener arms a
per-conversation debounce; 2 minutes quiet or 6 idle transitions (any reply
completing, including peer deliveries — extraction still filters to
owner-authored turns) fires one gateway side-call (`MEMORY_CAPTURE_MODEL`
when set and known to the registry, else the bot's own `modelId`, including
custom providers). The override is read at boot, not lazily from `process.env`.
Captures never overlap per conversation. Skip rules run
before any model call: memory off, no resolvable model (faux mode disables capture),
trivial window (advances the watermark without a call), no owner turns since
the watermark. Peer deliveries and routine fires are not memory sources —
only owner-authored turns count. One capture reads at most the newest
24 000 characters of whole lines; when the cap applies (a long backlog, or a
bot that predates memory with no watermark) the watermark still advances to
the window's end, so an oversized window never retries forever. Assistant replies provide context for the
owner's words, clipped to 1,500 characters each; error replies and replies
to peers/routines stay out. Role labels and assistant text do not count
toward the trivial threshold.

The extraction prompt carries the anti-junk contract (owner's words only,
third-person single sentences, no secrets or quoted text, `until` dates,
`supersedesIds` for contradictions), includes today's date for computing
temporary expiries, and returns JSON. `applyExtraction`
applies it in code: trimmed, case-insensitive text dedupe against all rows
including tombstones (a deleted fact is never re-added), supersession
validated to same-bot rows, watermark bump — one transaction, with budget
archival of the oldest active rows inside the same commit. Unparseable output
returns null and leaves the watermark unchanged, so the next capture retries.
The prompt also lists the 30 most recently deleted memories as "never add
these again, reworded or not": exact-text dedupe only blocks a literal
repeat, so this keeps "Owner prefers tea" (deleted) from returning as "The
owner likes tea".
Returned model errors (not just thrown errors) also preserve the watermark
and log the model id and error message.

## Chat-side saves and forgets

The `memory` capability also exposes `remember({ text, category, until? })`.
Use “Remember that I prefer TypeScript” to ask the bot to save a fact without
waiting for background capture. It uses the existing approval card (default
**Ask**); **Always allow** permits future saves for that bot without a prompt.
The tool must succeed before the bot can claim the fact was saved.

Saves use the same transaction, tombstone dedupe, and active-row budget as
background capture, with `source: capture` (“From chat”). They do not move
the capture watermark. Disabling memory refuses tool writes as well as
capture and injection. Existing read-only `MemoryStore` adapters remain
supported; they do not expose the tool.

`forget({ text })` removes memories from chat (“Forget that I'm moving to
Pune”). Every active memory containing all of the given words, as whole
words and case-insensitively, is tombstoned (`deleted`, like the page's
delete, so capture never re-adds it), and the tool returns the removed lines
so the bot can confirm exactly what went. Words that pick out nothing in
particular (“the owner”) are refused as too vague. It also defaults to
**Ask**.

Both tools work only in the owner's own turns. In a routine run or a turn
another bot started they are refused, even with **Always allow**: a memory
planted there (for example by injected web content) would reach every later
prompt. The check is `isUnattended` (`bots.unattended.ts`), shared with the
vault.

## API

The Memory page's add/edit form only asks for text and category, not a
“Forgets after” date. Manual additions have no expiry. Editing preserves an
existing automatic expiry; restoring an expired memory clears the past
expiry so it can stay active. Capture can still expire temporary facts, and
the API retains `until` support for compatibility.

- `GET /api/v1/bots/:id/memories?includeArchived=` — list (default hides
  archived and expired)
- `POST /api/v1/bots/:id/memories` — manual add (`source: manual`)
- `PATCH /api/v1/memories/:id` — edit, or `restore: true` to un-supersede
- `DELETE /api/v1/memories/:id` — tombstone, not a row removal
- `PATCH /api/v1/bots/:id` — `memoryEnabled`

## Lifecycle

| Status       | Meaning                         | Injected |
| ------------ | ------------------------------- | -------- |
| `active`     | current truth                   | yes      |
| `superseded` | replaced by a newer fact        | no       |
| `expired`    | `until` passed (flipped lazily) | no       |
| `archived`   | pushed out of the budget        | no       |
| `deleted`    | owner-removed tombstone         | no       |

Nothing is hard-deleted except by bot cascade; stale knowledge ages out
visibly.
