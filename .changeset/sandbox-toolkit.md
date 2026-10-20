---
"@tiny-agents/agent": minor
---

Sandbox toolkit (issue #19): a keyless shell on the shared sandbox VM over
Tailscale SSH. Three gated tools — run_command (exec with timeout and
detached mode), read_file (binary-safe SFTP; non-UTF-8 described, not corrupted)
and write_file (UTF-8 content, written to a temp name then renamed). One pooled ssh2 connection per process, no credentials
(the tailnet ACL is the authentication), TOFU host-key pinning persisted in
KV. Wired as a built-in capability behind SANDBOX_HOST / SANDBOX_PORT /
SANDBOX_USER; read_file defaults to allow, run_command and write_file ask.
