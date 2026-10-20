---
"@tiny-agents/agent": patch
---

The sandbox toolkit is configured out of the box: the app now defaults
SANDBOX_HOST to the verified MagicDNS name (tiny-agents-vm) when the env
variable is unset, so the capability is live after deploy without any env
change. Setting SANDBOX_HOST still overrides — e.g. the Tailscale IP if
MagicDNS breaks.
