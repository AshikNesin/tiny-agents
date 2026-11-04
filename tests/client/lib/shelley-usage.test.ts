/**
 * Usage aggregation for the context popup (issue #143): per-model token
 * bands with estimated cost, other (indirect) usage, and Shelley's number
 * formats, mirroring its own TokenCostGraph math.
 */
import { describe, expect, it } from "vite-plus/test";
import type { ModelCost, ShelleyMessage } from "@/lib/shelley/api";
import {
  distinctModels,
  formatTokenCount,
  formatUnitPrice,
  formatUsd,
  otherUsageBreakdown,
  otherUsageEntries,
  perModelUsage,
  subagentModelUsage,
  usageEntries,
} from "@/lib/shelley/usage";

const usage = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0,
    ...over,
  });

const msg = (type: string, fields: Record<string, unknown> = {}): ShelleyMessage =>
  ({
    message_id: `${type}-${Math.random()}`,
    sequence_id: 1,
    type,
    created_at: "2026-11-04T00:00:00Z",
    ...fields,
  }) as ShelleyMessage;

const GLM: ModelCost = { input: 0.079, output: 1.4, cache_read: 0.055, cache_write: 0 };
const costs: Record<string, ModelCost | null> = { "glm-5.3": GLM };

describe("usageEntries", () => {
  it("collects agent calls with tokens, skipping placeholders and other types", () => {
    const messages = [
      msg("system", { usage_data: usage({ input_tokens: 10 }) }),
      msg("agent", { usage_data: usage() }), // all-zero error placeholder
      msg("agent", { usage_data: usage({ input_tokens: 100, output_tokens: 5 }) }),
      msg("user"),
    ];
    const entries = usageEntries(messages);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ input_tokens: 100, output_tokens: 5 });
  });

  it("survives malformed usage JSON", () => {
    expect(usageEntries([msg("agent", { usage_data: "{not json" })])).toEqual([]);
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
    expect(m.model).toBe("glm-5.3");
    expect(m.priced).toBe(true);
    const cacheRead = m.rows.find((r) => r.label === "Cache read")!;
    expect(cacheRead.tokens).toBe(1_000_000);
    expect(cacheRead.unitUsdPerMtok).toBe(0.055);
    expect(cacheRead.cost).toBeCloseTo(0.055, 6);
    const output = m.rows.find((r) => r.label === "Output")!;
    expect(output.cost).toBeCloseTo(0.0014, 6);
    expect(m.totalCost).toBeCloseTo(0.0564, 6);
  });

  it("groups by model and marks unpriced models", () => {
    const entries = usageEntries([
      msg("agent", { usage_data: usage({ model: "glm-5.3", input_tokens: 10 }) }),
      msg("agent", { usage_data: usage({ model: "mystery", input_tokens: 10, cost_usd: 0.002 }) }),
    ]);
    const usage0 = perModelUsage(entries, { ...costs, mystery: null });
    expect(usage0.map((m) => m.model)).toEqual(["glm-5.3", "mystery"]);
    expect(usage0[1].priced).toBe(false);
    expect(usage0[1].reportedUsd).toBe(0.002);
  });
});

describe("otherUsageBreakdown", () => {
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
    expect(row).toMatchObject({ purpose: "slug", llmCalls: 2, tokens: 165, priced: true });
    expect(row.estimatedUsd).toBeCloseTo((110 * 0.079 + 55 * 1.4) / 1e6, 8);
  });
});

describe("subagentModelUsage", () => {
  it("maps Shelley's aggregate to band rows with tokens only", () => {
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
    expect(m.totalCost).toBe(0.05);
    expect(m.rows.every((r) => r.aggregate && !r.cost)).toBe(true);
    expect(m.rows.find((r) => r.label === "Cache read")!.tokens).toBe(1_000);
  });
});

describe("formats", () => {
  it("formats USD like Shelley at every magnitude", () => {
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(0.000088)).toBe("$0.0001");
    expect(formatUsd(0.161)).toBe("$0.161");
    expect(formatUsd(12.345)).toBe("$12.35");
  });

  it("formats token counts and unit prices", () => {
    expect(formatTokenCount(999)).toBe("999");
    expect(formatTokenCount(12_345)).toBe("12k");
    expect(formatTokenCount(2_500_000)).toBe("2.5M");
    expect(formatUnitPrice(1.4)).toBe("$1.40/M");
    expect(formatUnitPrice(0.079)).toBe("$0.079/M");
  });
});

describe("distinctModels", () => {
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
