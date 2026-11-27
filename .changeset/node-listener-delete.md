---
"tiny-agents": patch
---

Fix every DELETE request failing with a 500 ("Cannot read properties of undefined (reading 'window')") on the Node server after the 1Password fix. The server again lets its HTTP adapter replace the global `Request`, which the body limit needs, and only puts the built-in `Response` back for 1Password's SDK.
