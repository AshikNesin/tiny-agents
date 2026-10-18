---
"@groot/web": patch
---

Fix MCP OAuth sign-in failing after the provider redirects back: the callback route sat behind the JWT middleware, but the return from the authorization server is a cross-site navigation with no session cookie (SameSite=Strict in production) and no Authorization header, so it failed with `UNAUTHORIZED "No token provided"`. The callback is now public — like the client metadata document — and is authorized by the OAuth `state` parameter, which matches only a pending sign-in started by the connection's owner.
