---
"tiny-agents": patch
---

Server-sent event streams now cap the bytes buffered for a client that stopped reading. When a stream consumer stalls — a suspended tab, a dead proxy, a network drop — writes used to keep enqueueing frames into the response body with no bound, so one stalled client could grow server memory without limit. Each stream now drops the stalled consumer after 2 MB of backlog instead; the web client's existing reconnect logic re-establishes the stream, and healthy fast-reading clients are unaffected.
