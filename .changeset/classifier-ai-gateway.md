---
"@tiny-agents/agent": minor
---

Auto-review's classifier calls now go through the Cloudflare AI Gateway, so
reviews show up in its logs: `CLASSIFIER_GATEWAY_ID` names the gateway
(default `CLOUDFLARE_GATEWAY_ID`, the chat models' one), sent as
`cf-aig-gateway-id` on Workers AI's REST endpoint with `CLOUDFLARE_API_KEY` as
the gateway token. `CLASSIFIER_GATEWAY_ID=off` calls Workers AI directly as
before.
