/**
 * The vault's backends: what the agent's broker resolves through. Only the
 * local backend exists today; the port in `types.ts` stays so another
 * manager can be added behind it.
 */
import { createLocalBackend } from "./local";
import type { BackendName, VaultBackend } from "./types";

let backends: Map<BackendName, VaultBackend> | undefined;

/** Backends by name, built once per process. */
export function readBackends(): Map<BackendName, VaultBackend> {
  backends ??= new Map<BackendName, VaultBackend>([["local", createLocalBackend()]]);
  return backends;
}

/** Test seam: substitute backends (fakes). */
export function setReadBackendsForTests(map: Map<BackendName, VaultBackend> | undefined): void {
  backends = map;
}
