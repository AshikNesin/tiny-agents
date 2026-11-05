---
"@tiny-agents/agent": patch
---

Auto-review: the classifier now defaults to `typesafe/jev` and calls Workers
AI's `/accounts/{account}/ai/run` through the AI Gateway (`cf-aig-gateway-id`,
with `CLOUDFLARE_API_KEY` as `Authorization`). Through the gateway, the old
default `@cf/cloudflare/clef` bills against Unified Billing credits and, on the
gateway's `workers-ai` route, so did Jev: without credits every review failed
with 402 and the owner got every approval card. A failed review now logs a
warning with its error.
