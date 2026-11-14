/**
 * @tiny-agents/sandbox — the sandbox VM layer, with no pi-durable in it.
 *
 * The root is the one connection to the sandbox VM (ADR 0013): the app
 * builds it once from the endpoint and hands it to the toolkits, the
 * terminal, the browser and computer transports and the Claude worker. Plain
 * ssh2. Beside it: the forwarding server the Claude worker tunnels through,
 * shell quoting for the VM setup scripts, the public-URL guards the browser
 * and the web toolkit share, and the vault's pi-durable-free pieces the
 * browser and computer sinks need.
 *
 * Subpaths: `./terminal` (tmux tabs), `./browser` and `./computer` (live
 * sessions and their transports, VM setup), `./testing` (an in-process SSH
 * server). It imports neither pi-durable nor `@tiny-agents/agent` (lint R11);
 * the toolkits that drive it stay in `@tiny-agents/agent`
 * (docs/rewrite/DECISIONS.md D7). Child-only package: excluded from groot
 * sync via `.groot/boilerplate-sync.json` `additional_exclusions`.
 */
export {
  createSandboxConnection,
  type SandboxConnection,
  type SandboxConnectionOptions,
  type SandboxExecOptions,
  type SandboxExecResult,
  type SandboxFile,
} from "./ssh/sandbox-connection";
export type { PtySize, PtyStream } from "./ssh/pty-stream";
export {
  createMemoryHostKeyStore,
  SandboxTimeoutError,
  type HostKeyStore,
  type SshEndpoint,
} from "./ssh/connection";
export { createForwardingServer } from "./browser-remote-cdp";
export { shQuote } from "./browser-vm-setup";
export { checkPublicUrl, isPrivateAddress } from "./public-url";
export { SecretValue, VaultTargetMovedError } from "./vault-target";
