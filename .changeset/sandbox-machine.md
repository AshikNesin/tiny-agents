---
"@tiny-agents/sandbox": minor
"@tiny-agents/agent": patch
---

`createSandboxConnection` now takes a `SandboxMachine` instead of an SSH endpoint (ADR 0054). Wrap an existing endpoint with `sshMachine(endpoint)` for the same behaviour as before. A machine can get its host ready before each dial, which is what a sandbox that starts on demand, such as an AWS Lambda MicroVM, needs. The deprecated `@tiny-agents/agent/sandbox` subpath keeps its old signature.
