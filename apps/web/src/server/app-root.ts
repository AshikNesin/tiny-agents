import type { AgentRuntime } from "@tiny-agents/agent";

/**
 * The composition root (docs/rewrite/DECISIONS.md, D8): the app's long-lived
 * services in one object, filled once by the entry at boot (`entry.node.ts`)
 * or by a test, and read through `app()`. Phase 1 of docs/rewrite/PLAN.md
 * moves each module-level singleton here, one kind at a time, so boot,
 * shutdown and test resets each touch one place.
 */
export interface App {
  /** The open agent runtime; undefined until boot opened it (or a test installed one). */
  runtime: AgentRuntime | undefined;
  /** Boot finished opening the runtime: `/ready` and the Code registry wait on it. */
  runtimeReady: boolean;
}

const current: App = { runtime: undefined, runtimeReady: false };

/** The app's services, as boot (or a test) set them. */
export function app(): App {
  return current;
}

/** Test seam: install services (a fake runtime, say) without booting. */
export function installAppForTests(services: Partial<App>): void {
  Object.assign(current, services);
}
