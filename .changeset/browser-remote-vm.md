---
"@tiny-agents/agent": patch
---

Browser toolkit: chromium runs on the sandbox VM on deploys. With
SANDBOX_HOST set, each bot session launches a per-profile headless-shell on
that VM (localhost-only CDP) and tunnels it through the same keyless
Tailscale SSH channel as the sandbox toolkit — playwright-core in the app
container connects over CDP and nothing browser-related ships in the deploy
image. Closing a session kills the remote chromium.
