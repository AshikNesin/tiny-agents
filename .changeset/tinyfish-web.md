---
"@tiny-agents/agent": minor
---

Web search and page fetch go through TinyFish instead of Cloudflare. `web_search` calls `https://api.search.tinyfish.ai` and `web_fetch` calls `https://api.fetch.tinyfish.ai` (markdown, live fetch, `ttl: 0`). Both need `TINYFISH_API_KEY`; the calls themselves are on TinyFish's free tier. `CLOUDFLARE_API_BASE_URL` is no longer read.
