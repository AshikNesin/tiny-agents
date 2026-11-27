import { parseJson } from "@tiny-agents/std";
import { z } from "zod";
import type { UsageBand, UsageReport, UsageRow } from "../../contracts";
import type { ModelCost, ShelleyMessage, SubagentModelUsage } from "./wire";

export interface UsageEntry {
  input_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  model?: string;
  url?: string;
}

const optionalNumber = z.number().nullish().transform(orAbsent);
const optionalText = z.string().nullish().transform(orAbsent);

function orAbsent<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined;
}

const usageEntrySchema = z.object({
  input_tokens: optionalNumber,
  cache_creation_input_tokens: optionalNumber,
  cache_read_input_tokens: optionalNumber,
  output_tokens: optionalNumber,
  cost_usd: optionalNumber,
  model: optionalText,
  url: optionalText,
});

const otherUsageEntrySchema = usageEntrySchema.extend({ purpose: z.string() });

export type OtherUsageEntry = z.infer<typeof otherUsageEntrySchema>;

type PriceKey = keyof ModelCost;
type TokenKey =
  | "input_tokens"
  | "cache_creation_input_tokens"
  | "cache_read_input_tokens"
  | "output_tokens";

const TOKEN_BANDS: Array<{
  key: TokenKey;
  costKey: PriceKey;
  label: string;
  color: string;
}> = [
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

function parse<T>(what: string, raw: string | null | undefined, schema: z.ZodType<T>): T | null {
  if (!raw) return null;
  try {
    return parseJson(what, raw, schema);
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

export function usageEntries(messages: Iterable<ShelleyMessage>): UsageEntry[] {
  const out: UsageEntry[] = [];
  for (const m of messages) {
    if (m.type !== "agent") continue;
    const u = parse("A Shelley message's usage", m.usage_data, usageEntrySchema);
    if (hasTokens(u)) out.push(u);
  }
  return out;
}

export function otherUsageEntries(messages: Iterable<ShelleyMessage>): OtherUsageEntry[] {
  const out: OtherUsageEntry[] = [];
  for (const m of messages) {
    const rows = parse("A Shelley message's other usage", m.other_usage_data, z.array(z.unknown()));
    for (const row of rows ?? []) {
      const entry = otherUsageEntrySchema.safeParse(row);
      if (entry.success) out.push(entry.data);
    }
  }
  return out;
}

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

export function perModelUsage(
  entries: UsageEntry[],
  costs: Record<string, ModelCost | null | undefined>,
): UsageRow[] {
  const byModel = new Map<string, UsageRow>();
  const seenRate = new Map<string, Array<number | null | undefined>>();
  for (const e of entries) {
    const name = e.model || "unknown model";
    const cost = costs[name];
    let row = byModel.get(name);
    if (!row) {
      row = {
        label: name,
        bands: TOKEN_BANDS.map((band): UsageBand => ({
          label: band.label,
          color: band.color,
          tokens: 0,
          unitPrice: cost ? cost[band.costKey] : 0,
          costUsd: 0,
          priced: Boolean(cost),
        })),
        costUsd: 0,
        priced: Boolean(cost),
      };
      byModel.set(name, row);
      seenRate.set(
        name,
        TOKEN_BANDS.map(() => undefined),
      );
    }
    const rates = seenRate.get(name)!;
    TOKEN_BANDS.forEach((band, i) => {
      const tokens = e[band.key] || 0;
      const rate = cost ? cost[band.costKey] : 0;
      const usd = cost ? (tokens * rate) / 1e6 : 0;
      const target = row!.bands[i]!;
      target.tokens += tokens;
      target.costUsd += usd;
      row!.costUsd += usd;
      if (cost && tokens > 0) {
        const prev = rates[i];
        if (prev === undefined) rates[i] = rate;
        else if (prev !== null && prev !== rate) rates[i] = null;
      }
    });
    if (!cost) row.costUsd += e.cost_usd || 0;
  }
  for (const [name, rates] of seenRate) {
    const row = byModel.get(name)!;
    rates.forEach((rate, i) => {
      const band = row.bands[i]!;
      if (band.priced) band.unitPrice = rate ?? null;
    });
  }
  return [...byModel.values()];
}

export function otherUsageBreakdown(
  entries: OtherUsageEntry[],
  costs: Record<string, ModelCost | null | undefined>,
): UsageRow[] {
  const byPurpose = new Map<
    string,
    { row: UsageRow; estimated: number; reported: number; priced: boolean }
  >();
  for (const e of entries) {
    let p = byPurpose.get(e.purpose);
    if (!p) {
      p = {
        row: { label: e.purpose, bands: [], costUsd: 0, priced: true, tokens: 0, calls: 0 },
        estimated: 0,
        reported: 0,
        priced: true,
      };
      byPurpose.set(e.purpose, p);
    }
    const cost = e.model ? costs[e.model] : null;
    for (const band of TOKEN_BANDS) {
      const tokens = e[band.key] || 0;
      p.row.tokens = (p.row.tokens ?? 0) + tokens;
      if (cost) p.estimated += (tokens * cost[band.costKey]) / 1e6;
    }
    if (!cost) p.priced = false;
    p.row.calls = (p.row.calls ?? 0) + 1;
    p.reported += e.cost_usd || 0;
  }
  return [...byPurpose.values()].map((p) => ({
    ...p.row,
    priced: p.priced || p.reported > 0,
    costUsd: p.priced ? p.estimated : p.estimated || p.reported,
  }));
}

export function subagentModelUsage(perModel: SubagentModelUsage[] | undefined): UsageRow[] {
  return (perModel ?? []).map((m) => ({
    label: m.model,
    bands: TOKEN_BANDS.map((band): UsageBand => ({
      label: band.label,
      color: band.color,
      tokens: m[band.key],
      unitPrice: null,
      costUsd: 0,
      priced: true,
      aggregate: true,
    })),
    costUsd: m.estimated_usd || m.reported_usd || 0,
    priced: true,
  }));
}

export function usageReport(input: {
  messages: ShelleyMessage[];
  costs: Record<string, ModelCost | null> | null;
  subagents: SubagentModelUsage[] | null;
}): UsageReport {
  const entries = usageEntries(input.messages);
  const others = otherUsageEntries(input.messages);
  const costs = input.costs ?? {};
  const models = perModelUsage(entries, costs);
  const other = otherUsageBreakdown(others, costs);
  const subagents = subagentModelUsage(input.subagents ?? undefined);
  const mainUsd = models.reduce((sum, m) => sum + m.costUsd, 0);
  const otherUsd = other.reduce((sum, p) => sum + p.costUsd, 0);
  const subagentUsd = subagents.reduce((sum, m) => sum + m.costUsd, 0);
  const notes: string[] = [];
  if (input.costs === null && entries.length > 0) {
    notes.push("Pricing lookup failed; showing tokens.");
  } else if (models.some((m) => !m.priced) || other.some((p) => !p.priced)) {
    notes.push("Some models have no pricing; their totals may be incomplete.");
  }
  return {
    totalUsd: mainUsd + otherUsd + subagentUsd,
    mainUsd,
    subagentUsd,
    otherUsd,
    models,
    subagents,
    other,
    notes,
  };
}
