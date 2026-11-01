---
"@tiny-agents/agent": minor
---

Auto-review's classifier runs through the Cloudflare AI Gateway only, so every
review shows up in the gateway's logs. It calls the gateway's `workers-ai`
route with the same settings as chat models (`CLOUDFLARE_API_KEY` as
`cf-aig-authorization`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_GATEWAY_ID`);
without them auto-review stays off. Classifier ids read
`cloudflare-ai-gateway/<model>`.
