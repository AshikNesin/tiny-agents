---
"@tiny-agents/agent": patch
---

Browser toolkit: with SANDBOX_HOST set, bot browsers run on the sandbox VM —
each session launches a per-profile headless-shell there (CDP on 127.0.0.1,
tunneled through the same keyless Tailscale SSH channel as the sandbox
toolkit) and playwright-core connects over CDP. Closing a session kills the
remote chromium. Deploys without SANDBOX_HOST still fall back to the local
chain (apt chromium / bundled Chromium).
