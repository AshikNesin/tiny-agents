/**
 * `@tiny-agents/agent/sandbox`: the one connection to the sandbox VM (ADR
 * 0013). The app builds it once from the endpoint and hands it to the
 * toolkits, the terminal, the browser and computer transports and the Claude
 * worker. Plain ssh2; nothing here touches pi-durable.
 */
export {
  createSandboxConnection,
  type SandboxConnection,
  type SandboxConnectionOptions,
  type SandboxExecOptions,
  type SandboxExecResult,
  type SandboxFile,
} from "../ssh/sandbox-connection";
export type { PtySize, PtyStream } from "../ssh/pty-stream";
export { createMemoryHostKeyStore, type HostKeyStore, type SshEndpoint } from "../ssh/connection";
