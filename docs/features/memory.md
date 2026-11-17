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
- `conversationId` — the conversation it was learned in (capture or
  `remember`); null for the Memory page

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
pi-durable re-sends a section into the transcript each time its text
changes. So the block changes only for what the conversation can't already
know: a memory learned in that same conversation (its own capture, or
`remember` there) leaves the block it shows as it is, since the fact is
already in its context (Hermes Agent's frozen snapshot). A memory from
anywhere else, or any removal (delete, forget, supersede, expiry), refreshes
the block on the next message, and then it includes the conversation's own
new memories too. A new chat, or a compaction that drops the block, starts
from the full current set. It renders nothing when memory is off or empty
(zero prompt delta).

## Capture

`memories.capture.ts` + `memories.runner.ts`. Memory capture is the last step
of the settled pipeline (`bots.settled.ts`): each settled Turn of a bot's own
chat with memory on arms a per-conversation debounce; 2 minutes quiet or 6
settled Turns (any reply completing, including peer deliveries — extraction
still filters to owner-authored turns) fires one side-call through the
side-caller (`side-call.ts`, on the `memory_capture` model role: the model set
in Settings → Models, else the bot's own model when it runs on pi, else the
default model; aborted after 60 seconds). See [Models](./models.md#model-roles).
Captures never overlap per conversation. Skip rules run
before any model call: no side-caller (faux mode disables capture), memory
off, no owner turns since the watermark, trivial window (advances the
watermark without a call). A bot with no resolvable model gets no call; the
side-caller logs it and the window retries. Peer deliveries are not memory sources — only owner-authored
turns count — and a routine's own conversation is never captured (its runs
never enter the chat, see [routines](./routines.md)). One capture reads at most the newest
24 000 characters of whole lines; when the cap applies (a long backlog, or a
bot that predates memory with no watermark) the watermark still advances to
the window's end, so an oversized window never retries forever. Assistant replies provide context for the
owner's words; error replies and replies to peers stay out. Assistant replies are clipped to their first 500 characters:
they are only context for the owner's words. Role labels and assistant text do not count
toward the trivial threshold.

The extraction prompt carries the anti-junk contract (owner's words only,
third-person single sentences, no secrets or quoted text, `until` dates,
`supersedesIds` for contradictions), includes today's date for computing
temporary expiries, and returns JSON. Current memories are listed under short
refs (`m1`, `m2`, … as mem0 does), not row ids: a 36-character id on every
line costs tokens and invites a misspelled supersede. The runner maps the
refs back to rows before the ledger applies them. The memory ledger
(`memories.ledger.ts`, see Memory ledger in GLOSSARY.md) applies it in code:
text dedupe (ignoring case, runs of whitespace and end punctuation) against all rows including tombstones
(a deleted fact is never re-added), supersession of the same bot's active
rows only, expiry, budget archival of the oldest active rows and the
watermark bump — one transaction. Unparseable output
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

Saves go through the same memory ledger as background capture (tombstone
dedupe, the active-row budget, one transaction), with `source: capture` (“From chat”). They do not move
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

Both tools work only in the owner's own turns. In a routine run (any turn in
a routine's own conversation) or a turn another bot started they are refused,
even with **Always allow**: a memory planted there (for example by injected
web content) would reach every later prompt. The check is `isUnattended`
(`bots.owner.ts`), shared with the vault.

## API

The Memory page's add/edit form only asks for text and category, not a
“Forgets after” date. Manual additions have no expiry. Editing preserves an
existing automatic expiry; restoring an expired memory clears the past
expiry so it can stay active. Capture can still expire temporary facts, and
the API retains `until` support for compatibility.

- `GET /api/v1/bots/:id/memories?includeArchived=` — list (default hides
  archived and expired)
- `POST /api/v1/bots/:id/memories` — manual add (`source: manual`). It goes
  through the memory ledger too: text the bot already has active returns that
  memory; text of a deleted, archived, expired or superseded one brings that
  row back as a new active memory (the owner may undo their own delete, which
  capture and chat never do). Never a second row with the same text.
- `PATCH /api/v1/memories/:id` — edit, or `restore: true` to un-supersede;
  a restored memory is kept even when the budget is full (the oldest other
  active memory is archived instead)
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
