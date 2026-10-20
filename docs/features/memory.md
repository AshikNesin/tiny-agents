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

`Bot.memoryEnabled` gates capture and injection. `Bot.memoryCapturedThrough`
is the transcript watermark: capture commits it in the same transaction as
new rows, so a crash before commit re-runs the window harmlessly (exact-text
dedupe absorbs the repeat).

Constants live in `memories.domain.ts`: 100 active rows, 300 chars per row,
~6 000 char render cap, 2-minute quiet window, 6-turn trigger, 200-byte
trivial threshold.

## Injection

The `memory` capability (`packages/agent/src/toolkits/memory.ts`) renders one
prompt section through the store-adapter pattern (`memories.store.ts`):
active, unexpired rows in fixed category order then createdAt ascending.
`agentConfig()` enables it beside `skills` on every send, so the block always
reflects the current set. It renders `undefined` when memory is off or empty
(zero prompt delta), and its content only changes when memories change, so
provider prompt caching survives between captures.

## Capture

`memories.capture.ts` + `memories.runner.ts`. An `onActivity` listener arms a
per-conversation debounce; 2 minutes quiet or 6 owner turns fires one gateway
side-call (`MEMORY_CAPTURE_MODEL` when set, else the default). Skip rules run
before any model call: memory off, no model (faux mode, missing gateway),
trivial window (advances the watermark without a call), no owner turns since
the watermark. Peer deliveries and routine fires are not memory sources —
only owner-authored turns count.

The extraction prompt carries the anti-junk contract (owner's words only,
third-person single sentences, no secrets or quoted text, `until` dates,
`supersedesIds` for contradictions) and returns JSON. `applyExtraction`
applies it in code: exact-text dedupe against all rows including tombstones
(a deleted fact is never re-added), supersession validated to same-bot rows,
budget archive of the oldest active rows, watermark bump — one transaction.
Malformed output is dropped whole.

## API

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
