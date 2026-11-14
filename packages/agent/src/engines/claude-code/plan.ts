/**
 * The Claude plan as the app sees it, apart from any conversation (ADR 0008,
 * ADR 0016): the account's switch, fallback and turn limit, and the worker
 * on the sandbox. The runtime exposes it as `runtime.claudePlan`; the engine
 * reads the same state on each turn. No secrets.
 */
import type { ClaudePlanState } from "../../engine";
import type { ModelCatalog } from "@tiny-agents/models";
import {
  noWorkerLocator,
  type ClaudeAccountStatus,
  type ClaudeWorkerLocator,
  type ClaudeWorkerMode,
} from "./sandbox-worker";

/** The Claude plan account's switch and fallback, as the catalog has them now. */
export function claudePlanState(catalog: ModelCatalog): ClaudePlanState {
  const plan = catalog.claudePlan();
  return {
    enabled: plan?.enabled ?? false,
    fallback: plan?.fallbackModelId && catalog.route(plan.fallbackModelId) ? "gateway" : "pause",
    ...(plan?.maxTurns ? { maxTurns: plan.maxTurns } : {}),
  };
}

export interface ClaudePlanOptions {
  /** The account's switch and fallback, read on each call. Default: off, pause. */
  state?: () => ClaudePlanState;
  /** The worker on the sandbox, set up over SSH on first use. */
  worker?: ClaudeWorkerLocator;
}

export class ClaudePlan {
  readonly #state: () => ClaudePlanState;
  readonly #worker: ClaudeWorkerLocator;

  constructor(options: ClaudePlanOptions) {
    this.#state = options.state ?? (() => ({ enabled: false, fallback: "pause" }));
    this.#worker = options.worker ?? noWorkerLocator;
  }

  /** The switch, fallback and turn limit, as a turn reads them. */
  state(): ClaudePlanState {
    return this.#state();
  }

  /** Kill switch, fallback, and whether a worker is configured. No secrets. */
  status(): {
    enabled: boolean;
    fallback: ClaudePlanState["fallback"];
    configured: boolean;
    mode: ClaudeWorkerMode;
    workerHost?: string;
  } {
    const plan = this.#state();
    const locator = this.#worker;
    return {
      enabled: plan.enabled,
      fallback: plan.fallback,
      configured: locator.mode !== "none",
      mode: locator.mode,
      ...(locator.host ? { workerHost: locator.host } : {}),
    };
  }

  /** Whether Claude Code is installed and signed in where the worker runs. No secrets. */
  account(): Promise<ClaudeAccountStatus> {
    return this.#worker.account();
  }

  /** Set the worker up ahead of the first turn when the plan is on, so the first turn is quick. */
  prepare(): void {
    if (this.#state().enabled) this.#worker.prepare();
  }
}
