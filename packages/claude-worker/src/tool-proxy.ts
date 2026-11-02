/**
 * One in-flight tool call. A second request with the same tool_use_id
 * returns the same result and does not invoke the client again.
 * Silence for `timeoutMs` resolves as an error result so the Claude turn can finish.
 */
import type { ToolResultPayload } from "./protocol";

export interface ToolWaiter {
  resolve: (result: ToolResultPayload) => void;
  clear: () => void;
}

export type ArmTimer = (fn: () => void, ms: number) => () => void;

export const defaultArmTimer: ArmTimer = (fn, ms) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

export class ToolProxy {
  private readonly results = new Map<string, ToolResultPayload>();
  private readonly waiters = new Map<string, ToolWaiter>();
  /** Ids already announced to the client. A replay must not announce them again. */
  private readonly announced = new Set<string>();

  constructor(
    private readonly timeoutMs: number,
    private readonly arm: ArmTimer = defaultArmTimer,
  ) {}

  announcedIds(): readonly string[] {
    return [...this.announced];
  }

  hasAnnounced(toolUseId: string): boolean {
    return this.announced.has(toolUseId);
  }

  markAnnounced(toolUseId: string): boolean {
    if (this.announced.has(toolUseId)) return false;
    this.announced.add(toolUseId);
    return true;
  }

  /** Register interest before the event is published. Idempotent on tool_use_id. */
  wait(toolUseId: string): Promise<ToolResultPayload> {
    const cached = this.results.get(toolUseId);
    if (cached) return Promise.resolve(cached);
    const existing = this.waiters.get(toolUseId);
    if (existing) {
      return new Promise((resolve) => {
        const previous = existing.resolve;
        existing.resolve = (result) => {
          previous(result);
          resolve(result);
        };
      });
    }
    return new Promise((resolve) => {
      const clear = this.arm(() => {
        this.settle(toolUseId, {
          content: `Tool timed out after ${this.timeoutMs}ms without a result.`,
          isError: true,
        });
      }, this.timeoutMs);
      this.waiters.set(toolUseId, { resolve, clear });
    });
  }

  /**
   * Deliver a client result. A duplicate tool_use_id is ignored once the
   * first result is stored, so a replayed client cannot run the tool twice
   * on the worker side either.
   */
  settle(toolUseId: string, result: ToolResultPayload): boolean {
    if (this.results.has(toolUseId)) return false;
    this.results.set(toolUseId, result);
    const waiter = this.waiters.get(toolUseId);
    this.waiters.delete(toolUseId);
    waiter?.clear();
    waiter?.resolve(result);
    return true;
  }

  cached(toolUseId: string): ToolResultPayload | undefined {
    return this.results.get(toolUseId);
  }
}
