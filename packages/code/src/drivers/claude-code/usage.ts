/**
 * Usage from Claude Code's own `modelUsage` (reported per model on every
 * `result`, summed per turn by the worker). Claude Code reports one cost per
 * model; it is split across token bands by Anthropic's fixed price ratios
 * (output 5×, cache writes 1.25×, cache reads 0.1× the input price), so the
 * bands add up to the reported total.
 */
import type { UsageBand, UsageReport, UsageRow } from "../../contracts";

export interface ModelTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD: number;
  calls: number;
}

const BANDS: Array<{ key: keyof ModelTotals; label: string; color: string; weight: number }> = [
  { key: "cacheReadInputTokens", label: "Cache read", color: "oklch(0.72 0.13 229)", weight: 0.1 },
  {
    key: "cacheCreationInputTokens",
    label: "Cache write",
    color: "oklch(0.74 0.11 285)",
    weight: 1.25,
  },
  { key: "inputTokens", label: "Input", color: "oklch(0.72 0.13 165)", weight: 1 },
  { key: "outputTokens", label: "Output", color: "oklch(0.75 0.14 55)", weight: 5 },
];

export function usageReportOf(usage: Record<string, ModelTotals>): UsageReport {
  const models: UsageRow[] = [];
  for (const [model, totals] of Object.entries(usage)) {
    const weighted = BANDS.reduce((sum, band) => sum + totals[band.key] * band.weight, 0);
    const bands = BANDS.map((band): UsageBand => {
      const tokens = totals[band.key];
      const costUsd = weighted > 0 ? (totals.costUSD * tokens * band.weight) / weighted : 0;
      return {
        label: band.label,
        color: band.color,
        tokens,
        costUsd,
        unitPrice: tokens > 0 ? (costUsd / tokens) * 1_000_000 : 0,
        priced: true,
      };
    });
    models.push({
      label: model,
      bands,
      costUsd: totals.costUSD,
      calls: totals.calls,
      priced: true,
    });
  }
  models.sort((a, b) => b.costUsd - a.costUsd);
  const totalUsd = models.reduce((sum, row) => sum + row.costUsd, 0);
  return {
    totalUsd,
    mainUsd: totalUsd,
    subagentUsd: 0,
    otherUsd: 0,
    models,
    other: [],
    subagents: [],
    notes: [
      "Costs are what Claude Code reports for each turn. On a Claude plan they are an " +
        "estimate of API-equivalent value, not a charge.",
      "Calls count turns, not model requests.",
    ],
  };
}
