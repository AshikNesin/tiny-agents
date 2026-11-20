import type { ClaudePlanState } from "../../engine";
import type { ModelCatalog } from "@tiny-agents/models";
import {
  noWorkerLocator,
  type ClaudeAccountStatus,
  type ClaudeWorkerLocator,
  type ClaudeWorkerMode,
} from "./sandbox-worker";

export function claudePlanState(catalog: ModelCatalog): ClaudePlanState {
  const plan = catalog.claudePlan();
  return {
    enabled: plan?.enabled ?? false,
    fallback: plan?.fallbackModelId && catalog.route(plan.fallbackModelId) ? "gateway" : "pause",
    ...(plan?.maxTurns ? { maxTurns: plan.maxTurns } : {}),
  };
}

export interface ClaudePlanOptions {
  state?: () => ClaudePlanState;
  worker?: ClaudeWorkerLocator;
}

export class ClaudePlan {
  readonly #state: () => ClaudePlanState;
  readonly #worker: ClaudeWorkerLocator;

  constructor(options: ClaudePlanOptions) {
    this.#state = options.state ?? (() => ({ enabled: false, fallback: "pause" }));
    this.#worker = options.worker ?? noWorkerLocator;
  }

  state(): ClaudePlanState {
    return this.#state();
  }

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

  account(): Promise<ClaudeAccountStatus> {
    return this.#worker.account();
  }

  prepare(): void {
    if (this.#state().enabled) this.#worker.prepare();
  }
}
