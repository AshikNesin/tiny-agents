import {
  createSandboxConnection as connectToMachine,
  sshMachine,
  type SandboxConnection,
  type SandboxConnectionOptions,
  type SshEndpoint,
} from "@tiny-agents/sandbox";

export { createMemoryHostKeyStore } from "@tiny-agents/sandbox";
export type {
  HostKeyStore,
  PtySize,
  PtyStream,
  SandboxConnection,
  SandboxConnectionOptions,
  SandboxExecOptions,
  SandboxExecResult,
  SandboxFile,
  SshEndpoint,
} from "@tiny-agents/sandbox";

export function createSandboxConnection(
  endpoint: SshEndpoint,
  options?: SandboxConnectionOptions,
): SandboxConnection {
  return connectToMachine(sshMachine(endpoint), options);
}
