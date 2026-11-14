/**
 * `@tiny-agents/agent/sandbox`: moved to `@tiny-agents/sandbox` (rewrite step
 * 3.4). Re-exported so importers of this subpath keep compiling; nothing in
 * this repo imports them from here.
 */
export {
  /** @deprecated Import from `@tiny-agents/sandbox`. */
  createMemoryHostKeyStore,
  /** @deprecated Import from `@tiny-agents/sandbox`. */
  createSandboxConnection,
} from "@tiny-agents/sandbox";
export type {
  /** @deprecated Import from `@tiny-agents/sandbox`. */
  HostKeyStore,
  /** @deprecated Import from `@tiny-agents/sandbox`. */
  PtySize,
  /** @deprecated Import from `@tiny-agents/sandbox`. */
  PtyStream,
  /** @deprecated Import from `@tiny-agents/sandbox`. */
  SandboxConnection,
  /** @deprecated Import from `@tiny-agents/sandbox`. */
  SandboxConnectionOptions,
  /** @deprecated Import from `@tiny-agents/sandbox`. */
  SandboxExecOptions,
  /** @deprecated Import from `@tiny-agents/sandbox`. */
  SandboxExecResult,
  /** @deprecated Import from `@tiny-agents/sandbox`. */
  SandboxFile,
  /** @deprecated Import from `@tiny-agents/sandbox`. */
  SshEndpoint,
} from "@tiny-agents/sandbox";
