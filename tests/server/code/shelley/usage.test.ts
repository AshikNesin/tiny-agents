import { describe, expect, it } from "vite-plus/test";
import {
  distinctModels,
  otherUsageBreakdown,
  otherUsageEntries,
  perModelUsage,
  subagentModelUsage,
  usageEntries,
  usageReport,
} from "../../../../packages/code/src/drivers/shelley/usage";
import type { ModelCost, ShelleyMessage } from "../../../../packages/code/src/drivers/shelley/wire";

const usage = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0,
    ...over,
  });

let seq = 0;
const msg = (type: string, fields: Record<string, unknown> = {}): ShelleyMessage =>
  ({
    message_id: `${type}-${++seq}`,
    sequence_id: seq,
    type,
    created_at: "2026-11-04T00:00:00Z",
    ...fields,
  }) as ShelleyMessage;

const GLM: ModelCost = { input: 0.079, output: 1.4, cache_read: 0.055, cache_write: 0 };
const costs: Record<string, ModelCost | null> = { "glm-5.3": GLM };

describe("usageEntries", () => {
  it("collects agent calls with tokens, skipping placeholders and other types", () => {
    const entries = usageEntries([
      msg("system", { usage_data: usage({ input_tokens: 10 }) }),
      msg("agent", { usage_data: usage() }),
      msg("agent", { usage_data: usage({ input_tokens: 100, output_tokens: 5 }) }),
      msg("agent", { usage_data: "{not json" }),
      msg("user"),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ input_tokens: 100, output_tokens: 5 });
  });
});

describe("perModelUsage", () => {
  it("splits one model's calls into priced token bands", () => {
    const entries = usageEntries([
      msg("agent", {
        usage_data: usage({
          model: "glm-5.3",
          cache_read_input_tokens: 1_000_000,
          output_tokens: 1_000,
        }),
      }),
    ]);
    const [m] = perModelUsage(entries, costs);
    expect(m).toMatchObject({ label: "glm-5.3", priced: true });
    const cacheRead = m!.bands.find((b) => b.label === "Cache read")!;
    expect(cacheRead).toMatchObject({ tokens: 1_000_000, unitPrice: 0.055 });
    expect(cacheRead.costUsd).toBeCloseTo(0.055, 6);
    expect(m!.bands.find((b) => b.label === "Output")!.costUsd).toBeCloseTo(0.0014, 6);
    expect(m!.costUsd).toBeCloseTo(0.0564, 6);
  });

  it("groups by model; an unpriced model falls back to the reported cost", () => {
    const entries = usageEntries([
      msg("agent", { usage_data: usage({ model: "glm-5.3", input_tokens: 10 }) }),
      msg("agent", { usage_data: usage({ model: "mystery", input_tokens: 10, cost_usd: 0.002 }) }),
    ]);
    const rows = perModelUsage(entries, { ...costs, mystery: null });
    expect(rows.map((m) => m.label)).toEqual(["glm-5.3", "mystery"]);
    expect(rows[1]).toMatchObject({ priced: false, costUsd: 0.002 });
  });

  it("reports mixed rates for a band served at two prices", () => {
    const entries = usageEntries([
      msg("agent", { usage_data: usage({ model: "m", input_tokens: 10 }) }),
      msg("agent", { usage_data: usage({ model: "m", input_tokens: 10 }) }),
    ]);
    let calls = 0;
    const flipping = new Proxy({} as Record<string, ModelCost>, {
      get: () => ({ ...GLM, input: ++calls > 1 ? 1 : 2 }),
    });
    const [m] = perModelUsage(entries, flipping);
    expect(m!.bands.find((b) => b.label === "Input")!.unitPrice).toBeNull();
  });
});

describe("indirect and subagent usage", () => {
  it("aggregates indirect rows by purpose with estimated cost", () => {
    const entries = otherUsageEntries([
      msg("system", {
        other_usage_data: JSON.stringify([
          { purpose: "slug", input_tokens: 100, output_tokens: 50, model: "glm-5.3" },
          { purpose: "slug", input_tokens: 10, output_tokens: 5, model: "glm-5.3" },
        ]),
      }),
    ]);
    const [row] = otherUsageBreakdown(entries, costs);
    expect(row).toMatchObject({ label: "slug", calls: 2, tokens: 165, priced: true });
    expect(row!.costUsd).toBeCloseTo((110 * 0.079 + 55 * 1.4) / 1e6, 8);
  });

  it("maps Shelley's subagent aggregate to band rows with tokens only", () => {
    const [m] = subagentModelUsage([
      {
        model: "glm-5.3",
        llm_calls: 3,
        input_tokens: 100,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 1_000,
        output_tokens: 10,
        estimated_usd: 0.05,
        reported_usd: 0,
      },
    ]);
    expect(m!.costUsd).toBe(0.05);
    expect(m!.bands.every((b) => b.aggregate && !b.costUsd)).toBe(true);
    expect(m!.bands.find((b) => b.label === "Cache read")!.tokens).toBe(1_000);
  });

  it("dedupes (model, url) pairs across direct and other usage", () => {
    const entries = usageEntries([
      msg("agent", { usage_data: usage({ model: "glm-5.3", url: "https://x", output_tokens: 1 }) }),
      msg("agent", { usage_data: usage({ model: "glm-5.3", url: "https://x", input_tokens: 1 }) }),
    ]);
    const others = otherUsageEntries([
      msg("system", {
        other_usage_data: JSON.stringify([{ purpose: "slug", model: "tiny", url: "https://y" }]),
      }),
    ]);
    expect(distinctModels(entries, others)).toEqual([
      { model: "glm-5.3", url: "https://x" },
      { model: "tiny", url: "https://y" },
    ]);
  });
});

describe("usageReport", () => {
  const messages = [
    msg("agent", { usage_data: usage({ model: "glm-5.3", input_tokens: 1_000_000 }) }),
  ];

  it("adds main, indirect and subagent totals", () => {
    const report = usageReport({ messages, costs, subagents: [] });
    expect(report.mainUsd).toBeCloseTo(0.079, 6);
    expect(report.totalUsd).toBeCloseTo(0.079, 6);
    expect(report.notes).toEqual([]);
  });

  it("says when pricing failed or is incomplete", () => {
    expect(usageReport({ messages, costs: null, subagents: null }).notes).toEqual([
      "Pricing lookup failed; showing tokens.",
    ]);
    expect(usageReport({ messages, costs: {}, subagents: null }).notes).toEqual([
      "Some models have no pricing; their totals may be incomplete.",
    ]);
  });
});
