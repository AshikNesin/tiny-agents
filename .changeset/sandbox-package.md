---
"@tiny-agents/sandbox": minor
"@tiny-agents/agent": patch
---

New package `@tiny-agents/sandbox`: the sandbox VM layer without pi-durable (rewrite step 3.4, no behavior change).

- **Moved:** the SSH connection (`ssh/`), terminal tabs (`terminal/`), the browser and computer session managers and their transports (local Chromium, remote CDP, X11), the browser and computer VM setup scripts, `createForwardingServer`, the in-process test SSH server, the public-URL guards and the vault's pi-durable-free pieces (`SecretValue`, `VaultTargetMovedError`) leave `@tiny-agents/agent` for `@tiny-agents/sandbox`. Subpaths: `./terminal`, `./browser`, `./computer`, `./testing`.
- **Boundary:** the package imports neither pi-durable nor `@tiny-agents/agent`; lint R11 now covers it as well as `@tiny-agents/models`.
- **`@tiny-agents/agent`:** depends on `@tiny-agents/sandbox`; the browser, computer and sandbox toolkits stay here and drive it. `./sandbox`, `./terminal`, `./browser` and `./computer` still export every name they exported before, and the root still exports `SecretFillField`, `checkPublicUrl` and `isPrivateAddress` and `./testing` `startFakeSandboxServer`, all re-exported from `@tiny-agents/sandbox` and marked `@deprecated`. Import them from `@tiny-agents/sandbox` instead. `SecretValue` and `VaultTargetMovedError` stay on the root as part of the vault port.
