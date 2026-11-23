---
"tiny-agents": patch
"@groot/core": patch
"@groot/jobs": patch
---

Tightened five check-then-act races and added input caps on the job admin API. Two concurrent creates of the same task idempotency key or skill name now return the existing row or a clean 409 instead of a raw SqliteError 500; a passkey rename that loses a race with its delete says 404 instead of crashing; registering the same credential twice concurrently says 409; and a kv entry refreshed while a stale read was expiring it survives. Singleton jobs are now enforced by a partial unique index on (name, singleton_key) for created and active states, so two concurrent enqueues of one singleton key create one job. Job options are capped (100 bulk-rerun ids, retryLimit ≤ 100, priority and delays bounded) and job log responses are limited to 500 rows.
