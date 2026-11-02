---
"@tiny-agents/agent": minor
---

The sandbox can be a local Docker container for machines that can't join
the tailnet (docs/guides/local-sandbox.md). The shared SSH dial and every
transport built on it (sandbox, attachments, terminal, browser, computer)
take an optional `privateKey` for public-key auth; without one they dial
keyless Tailscale SSH as before. The app reads it from SANDBOX_SSH_KEY_FILE or
SANDBOX_SSH_KEY, and `pnpm sandbox:up` builds, keys and starts the container.
