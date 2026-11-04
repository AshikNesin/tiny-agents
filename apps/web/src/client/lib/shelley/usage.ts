/**
 * Usage math for the composer's context popup (issue #143), a port of
 * Shelley's own usage table (its ui/src/utils/tokenCostGraph.ts): a
 * conversation's per-call usage records become per-model, per-band token and
 * cost rows, "other" (indirect) usage — compaction, slug generation, … —
 * becomes per-purpose rows, and subagent usage joins as its own column.
 *
 * Costs are estimated as tokens × models.dev rate / 1e6; where a model has no
 * pricing the rows fall back to provider-reported cost_usd and the popup says
 * so. All-zero usage records (error placeholders) are skipped, matching
 * Shelley's graph.
 */
import type { ModelCost, ShelleyMessage, SubagentModelUsage } from "./api";

/** One LLM call's usage record (a message's parsed usage_data). */
export interface UsageEntry {
  input_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  model?: string;
  url?: string;
}

/** One raw other-usage entry (an item of a message's other_usage_data). */
export interface OtherUsageEntry {
  purpose: string;
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  model?: string;
  url?: string;
}

export type PriceKey = "input" | "output" | "cache_read" | "cache_write";

export interface TokenBand {
  key: keyof Pick<
    UsageEntry,
    "input_tokens" | "cache_creation_input_tokens" | "cache_read_input_tokens" | "output_tokens"
  >;
  costKey: PriceKey;
  label: string;
  /** The popup's chip color (Shelley's band hue, as oklch). */
  color: string;
}

/** Display order: cache read first (it dominates agent conversation volume). */
export const TOKEN_BANDS: TokenBand[] = [
  {
    key: "cache_read_input_tokens",
    costKey: "cache_read",
    label: "Cache read",
    color: "oklch(0.72 0.13 229)",
  },
  {
    key: "cache_creation_input_tokens",
    costKey: "cache_write",
    label: "Cache write",
    color: "oklch(0.74 0.11 285)",
  },
  { key: "input_tokens", costKey: "input", label: "Input", color: "oklch(0.72 0.13 165)" },
  { key: "output_tokens", costKey: "output", label: "Output", color: "oklch(0.75 0.14 55)" },
];

function parse<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function hasTokens(u: Partial<UsageEntry> | null): u is UsageEntry {
  return Boolean(
    u &&
    (u.input_tokens ?? 0) +
      (u.cache_creation_input_tokens ?? 0) +
      (u.cache_read_input_tokens ?? 0) +
      (u.output_tokens ?? 0) >
      0,
  );
}

/** Direct per-call usage of a conversation's agent messages, in order. */
export function usageEntries(messages: Iterable<ShelleyMessage>): UsageEntry[] {
  const out: UsageEntry[] = [];
  for (const m of messages) {
    if (m.type !== "agent") continue;
    const u = parse<UsageEntry>(m.usage_data);
    if (hasTokens(u)) out.push(u);
  }
  return out;
}

/** Raw other-usage entries from every message that carries one. */
export function otherUsageEntries(messages: Iterable<ShelleyMessage>): OtherUsageEntry[] {
  const out: OtherUsageEntry[] = [];
  for (const m of messages) {
    const rows = parse<OtherUsageEntry[]>(m.other_usage_data);
    if (Array.isArray(rows)) out.push(...rows.filter((r) => r && typeof r.purpose === "string"));
  }
  return out;
}

/** The distinct (model, url) pairs to price, first-seen order. */
export function distinctModels(
  entries: Iterable<UsageEntry>,
  others: Iterable<OtherUsageEntry> = [],
): Array<{ model: string; url: string }> {
  const seen = new Map<string, string>();
  for (const e of [...entries, ...others]) {
    if (e.model && !seen.has(e.model)) seen.set(e.model, e.url ?? "");
  }
  return [...seen].map(([model, url]) => ({ model, url }));
}

export interface BandRow {
  label: string;
  color: string;
  tokens: number;
  /** USD per Mtok; null when the model served this band at mixed rates. */
  unitUsdPerMtok: number | null;
  cost: number;
  priced: boolean;
  /** True for rows built from an aggregate (subagents): token counts only,
   *  with no per-band rate or cost to show. */
  aggregate?: boolean;
}

export interface ModelUsage {
  model: string;
  /** Token totals and estimated cost per band. */
  rows: BandRow[];
  /** Sum of the band costs. */
  totalCost: number;
  /** Sum of provider-reported cost_usd. */
  reportedUsd: number;
  priced: boolean;
}

/** Aggregate entries into per-model band rows, estimating cost with the
 *  tokens × rate / 1e6 formula. A band served at two rates reports null
 *  ("mixed rates"), as Shelley's table does. */
export function perModelUsage(
  entries: UsageEntry[],
  costs: Record<string, ModelCost | null | undefined>,
): ModelUsage[] {
  const byModel = new Map<string, ModelUsage>();
  // Per (model, band): the rate charged so far, so a band served at two
  // rates reports "mixed" rather than the last one seen.
  const seenRate = new Map<string, Array<number | null | undefined>>();
  for (const e of entries) {
    const name = e.model || "unknown model";
    const cost = costs[name];
    let mu = byModel.get(name);
    if (!mu) {
      mu = {
        model: name,
        rows: TOKEN_BANDS.map((band) => ({
          label: band.label,
          color: band.color,
          tokens: 0,
          unitUsdPerMtok: cost ? cost[band.costKey] : 0,
          cost: 0,
          priced: Boolean(cost),
        })),
        totalCost: 0,
        reportedUsd: 0,
        priced: Boolean(cost),
      };
      byModel.set(name, mu);
      seenRate.set(
        name,
        TOKEN_BANDS.map(() => undefined),
      );
    }
    const rates = seenRate.get(name)!;
    mu.reportedUsd += e.cost_usd || 0;
    TOKEN_BANDS.forEach((band, i) => {
      const tokens = e[band.key] || 0;
      const rate = cost ? cost[band.costKey] : 0;
      const usd = cost ? (tokens * rate) / 1e6 : 0;
      const row = mu!.rows[i];
      row.tokens += tokens;
      row.cost += usd;
      mu!.totalCost += usd;
      if (cost && tokens > 0) {
        const prev = rates[i];
        if (prev === undefined) rates[i] = rate;
        else if (prev !== null && prev !== rate) rates[i] = null;
      }
    });
  }
  for (const [name, rates] of seenRate) {
    const mu = byModel.get(name)!;
    rates.forEach((rate, i) => {
      if (mu.rows[i].priced) mu.rows[i].unitUsdPerMtok = rate ?? null;
    });
  }
  return [...byModel.values()];
}

export interface OtherPurposeUsage {
  purpose: string;
  llmCalls: number;
  tokens: number;
  estimatedUsd: number;
  reportedUsd: number;
  priced: boolean;
}

/** Aggregate other-usage entries by purpose (compaction, slug, …). */
export function otherUsageBreakdown(
  entries: OtherUsageEntry[],
  costs: Record<string, ModelCost | null | undefined>,
): OtherPurposeUsage[] {
  const byPurpose = new Map<string, OtherPurposeUsage>();
  for (const e of entries) {
    let p = byPurpose.get(e.purpose);
    if (!p) {
      p = {
        purpose: e.purpose,
        llmCalls: 0,
        tokens: 0,
        estimatedUsd: 0,
        reportedUsd: 0,
        priced: true,
      };
      byPurpose.set(e.purpose, p);
    }
    const cost = e.model ? costs[e.model] : null;
    for (const band of TOKEN_BANDS) {
      const tokens = e[band.key] || 0;
      p.tokens += tokens;
      if (cost) p.estimatedUsd += (tokens * cost[band.costKey]) / 1e6;
    }
    if (!cost) p.priced = false;
    p.llmCalls += 1;
    p.reportedUsd += e.cost_usd || 0;
  }
  return [...byPurpose.values()];
}

/** The subagent column of the popup: token sums per model, cost from
 *  Shelley's own aggregate (estimated, or reported when the gateway knows). */
export function subagentModelUsage(perModel: SubagentModelUsage[] | undefined): ModelUsage[] {
  return (perModel ?? []).map((m) => ({
    model: m.model,
    rows: TOKEN_BANDS.map((band) => ({
      label: band.label,
      color: band.color,
      tokens: m[band.key],
      // One aggregate rate is not recoverable from an estimated total; the
      // model row carries the cost, band rows carry token counts only.
      unitUsdPerMtok: null,
      cost: 0,
      priced: true,
      aggregate: true,
    })),
    totalCost: m.estimated_usd || m.reported_usd || 0,
    reportedUsd: m.reported_usd || 0,
    priced: true,
  }));
}

/** "$0", "$0.0042", "$0.161", "$12.35" — Shelley's formatUsd. */
export function formatUsd(v: number): string {
  if (v === 0) return "$0";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 1) return `$${v.toFixed(3)}`;
  if (v < 100) return `$${v.toFixed(2)}`;
  return `$${Math.round(v).toLocaleString()}`;
}

/** "12k", "2.5M" — Shelley's formatTokenCount. */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 999_500_000) return `${(tokens / 1e9).toFixed(1)}B`;
  if (tokens >= 999_500) return `${(tokens / 1e6).toFixed(1)}M`;
  if (tokens >= 1e3) return `${(tokens / 1e3).toFixed(0)}k`;
  return String(tokens);
}

/** "$1.40/M", "$0.079/M" — a band's unit price. */
export function formatUnitPrice(usdPerMtok: number): string {
  let s: string;
  if (Number.isInteger(usdPerMtok)) s = String(usdPerMtok);
  else if (usdPerMtok >= 0.1) s = usdPerMtok.toFixed(2);
  else s = usdPerMtok.toPrecision(2).replace(/\.?0+$/, "");
  return `$${s}/M`;
}
