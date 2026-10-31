---
"@groot/core": minor
---

`createApp({ openCorsPaths })` serves public endpoints to any website without credentials (`Access-Control-Allow-Origin: *`), bypassing the app's credentialed CORS allow-list for just those paths. Use it for embeddable widgets and tracking endpoints that customer sites call from their own origin; previously the global middleware answered their preflights first, so setting `CORS_ALLOWED_ORIGINS` silently broke them.

Exact paths or a `prefix*` (`openCorsPaths: ["/api/track", "/widget/*"]`). Unset, nothing changes.
