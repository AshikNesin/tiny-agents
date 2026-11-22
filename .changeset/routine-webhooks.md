---
"tiny-agents": minor
---

Routines can run on a webhook. Pick the Webhook schedule, then use Webhook URL on the routine to get a secret URL; a POST to it runs the routine with the request body as data. Deliveries are acknowledged at once, a repeated delivery id runs once, deliveries that arrive during a run go into the next run together, and an hourly cap keeps a noisy sender from running up the bill.
