---
"@tiny-agents/agent": patch
---

Auto-review: the classifier now calls Workers AI's `/accounts/{account}/ai/run`
through the AI Gateway (`cf-aig-gateway-id`) with `CLOUDFLARE_API_KEY` as
`Authorization`. The gateway's `workers-ai` route with only
`cf-aig-authorization` sent Workers AI no credentials, so every review failed
and the owner got every approval card. The review timeout rises from 3 to 10
seconds so third-party classifiers such as `typesafe/jev` can answer, and a
failed review now logs a warning with its error.
