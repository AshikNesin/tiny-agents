---
"@groot/jobs": patch
---

Jobs dashboard fixes: cancelling a schedule URL-encodes the job name; the stats tiles show their state colours; a failed background poll keeps showing the loaded job instead of "Job Not Found"; persisted `fatal` log rows render as errors; the Add Job button is disabled while the request is in flight, so a double click no longer enqueues the job twice.
