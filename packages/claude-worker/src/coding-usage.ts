import { record } from "@tiny-agents/std";

export interface UsageTotals {
  [model: string]: Record<string, number>;
}

export class UsageMeter {
  cost = 0;
  private base: UsageTotals = {};

  reset(): void {
    this.cost = 0;
    this.base = {};
  }

  turnCost(total: number): number {
    const turnCost = total >= this.cost ? total - this.cost : total;
    this.cost = total;
    return turnCost;
  }

  delta(usage: Record<string, unknown>): UsageTotals {
    const delta: UsageTotals = {};
    const next: UsageTotals = {};
    for (const [model, value] of Object.entries(usage)) {
      const fields = record(value);
      if (!fields) continue;
      const base = this.base[model] ?? {};
      const now: Record<string, number> = {};
      const diff: Record<string, number> = {};
      for (const [key, raw] of Object.entries(fields)) {
        if (typeof raw !== "number") continue;
        now[key] = raw;
        const before = base[key] ?? 0;
        diff[key] =
          key === "contextWindow" || key === "maxOutputTokens" || raw < before ? raw : raw - before;
      }
      next[model] = now;
      delta[model] = diff;
    }
    this.base = next;
    return delta;
  }
}

export function roundCost(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
