import { describe, expect, it } from "vite-plus/test";
import {
  extractionResultSchema,
  isExpired,
  MEMORY_MAX_ACTIVE,
  MEMORY_RENDER_CHAR_CAP,
  renderMemoryBlock,
} from "../../../../apps/web/src/server/api/bots/memories.domain";

const base = {
  id: "m1",
  category: "preference" as const,
  until: null,
  createdAt: "2026-10-01T00:00:00.000Z",
};

describe("renderMemoryBlock", () => {
  it("returns null for an empty list (zero prompt delta)", () => {
    expect(renderMemoryBlock([])).toBeNull();
  });

  it("filters expired memories at render time", () => {
    const block = renderMemoryBlock([
      { ...base, text: "Likes dark mode", until: "2020-01-01T00:00:00.000Z" },
    ]);
    expect(block).toBeNull();
  });

  it("orders by fixed category order then createdAt, deterministic across calls", () => {
    const memories = [
      {
        ...base,
        id: "a",
        text: "A habit",
        category: "habit" as const,
        createdAt: "2026-10-01T00:00:01.000Z",
      },
      {
        ...base,
        id: "b",
        text: "B fact",
        category: "fact" as const,
        createdAt: "2026-10-01T00:00:02.000Z",
      },
      {
        ...base,
        id: "c",
        text: "C preference",
        category: "preference" as const,
        createdAt: "2026-10-01T00:00:00.000Z",
      },
      {
        ...base,
        id: "d",
        text: "D preference",
        category: "preference" as const,
        createdAt: "2026-10-01T00:00:03.000Z",
      },
    ];
    const block = renderMemoryBlock(memories)!;
    const lines = block.split("\n").filter((l) => l.startsWith("- "));
    expect(lines.map((l) => l.slice(2, 4))).toEqual(["C ", "D ", "B ", "A "]);
    expect(renderMemoryBlock(memories)).toBe(block);
  });

  it("caps the rendered block and keeps the newest entries", () => {
    const memories = Array.from({ length: 100 }, (_, i) => ({
      ...base,
      id: `m${i}`,
      text: `Fact number ${i} `.repeat(10).trim(),
      createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
    }));
    const block = renderMemoryBlock(memories)!;
    expect(block.length).toBeLessThanOrEqual(MEMORY_RENDER_CHAR_CAP + 60);
    expect(block).toContain("Fact number 99");
    expect(block).toContain("older memories omitted");
  });

  it("drops the oldest entries first when the cap overflows", () => {
    const memories = Array.from({ length: 200 }, (_, i) => ({
      ...base,
      id: `m${i}`,
      text: `Fact ${String(i).padStart(3, "0")} ${"x".repeat(20)}`,
      createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
    }));
    const block = renderMemoryBlock(memories)!;
    expect(block).toContain("Fact 199");
    expect(block).not.toContain("Fact 000");
    expect(block).not.toContain("Fact 010");
  });

  it("keeps the newest memories across categories, rendered in category order", () => {
    // Old preferences (rendered first) and new habits (rendered last): the
    // cap must drop the old preferences, not the newest habits.
    const memories = [
      ...Array.from({ length: 60 }, (_, i) => ({
        ...base,
        id: `p${i}`,
        text: `Old preference ${String(i).padStart(2, "0")} ${"p".repeat(80)}`,
        category: "preference" as const,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
      })),
      ...Array.from({ length: 60 }, (_, i) => ({
        ...base,
        id: `h${i}`,
        text: `New habit ${String(i).padStart(2, "0")} ${"h".repeat(80)}`,
        category: "habit" as const,
        createdAt: new Date(Date.UTC(2026, 5, 1, 0, i)).toISOString(),
      })),
    ];
    const block = renderMemoryBlock(memories)!;
    const lines = block.split("\n").filter((l) => l.startsWith("- "));
    const kept = lines.filter((l) => !l.includes("omitted"));
    expect(kept.filter((l) => l.includes("New habit"))).toHaveLength(60);
    expect(block).not.toContain("Old preference 00");
    expect(lines.at(-1)).toBe(`- …${120 - kept.length} older memories omitted`);
    // Kept preferences still render before habits.
    const firstHabit = kept.findIndex((l) => l.includes("New habit"));
    expect(kept.slice(0, firstHabit).every((l) => l.includes("Old preference"))).toBe(true);
    expect(block.length).toBeLessThanOrEqual(MEMORY_RENDER_CHAR_CAP + 60);
  });

  it("renders the until date as a suffix", () => {
    // A fixed clock: against the real one this memory expires and renders nothing.
    const now = new Date("2026-10-20T00:00:00.000Z");
    const block = renderMemoryBlock(
      [{ ...base, text: "Is in Goa until Friday", until: "2026-10-23T18:00:00.000Z" }],
      now,
    )!;
    expect(block).toContain("(until 2026-10-23)");
  });
});

describe("isExpired", () => {
  it("is false for null until and future until, true for past", () => {
    const now = new Date("2026-10-21T00:00:00.000Z");
    expect(isExpired({ until: null }, now)).toBe(false);
    expect(isExpired({ until: "2026-10-22T00:00:00.000Z" }, now)).toBe(false);
    expect(isExpired({ until: "2026-10-20T00:00:00.000Z" }, now)).toBe(true);
  });
});

describe("extractionResultSchema", () => {
  it("accepts date-only until values from the model", () => {
    const parsed = extractionResultSchema.parse([
      { text: "Is in Goa until Friday", category: "fact", until: "2026-10-23" },
    ]);
    expect(parsed[0].until).toBe("2026-10-23");
  });

  it("accepts null and normalizes to empty", () => {
    expect(extractionResultSchema.parse(null)).toEqual([]);
  });

  it("drops an array with one invalid item wholesale via safeParse", () => {
    const bad = [
      { text: "Valid fact", category: "fact" },
      { text: "", category: "fact" },
    ];
    expect(extractionResultSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts a well-formed extraction with optional fields", () => {
    const good = [
      {
        text: "Prefers TypeScript",
        category: "preference",
        until: null,
        supersedesIds: ["m1"],
      },
    ];
    expect(extractionResultSchema.parse(good)).toHaveLength(1);
  });
});

describe("active budget", () => {
  it("fits a full budget of typical memories in the prompt, none omitted", () => {
    // Issue #334 A: about 80 chars a memory; past the render cap a memory
    // would sit in the store with no way for the bot to reach it.
    const memories = Array.from({ length: MEMORY_MAX_ACTIVE }, (_, i) => ({
      ...base,
      id: `m${i}`,
      text: `The owner keeps a typical fact of about eighty characters long, numbered ${String(i).padStart(3, "0")} now`,
      createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
    }));
    expect(memories[0]!.text).toHaveLength(80);
    const block = renderMemoryBlock(memories)!;
    expect(block).not.toContain("omitted");
    expect(block.split("\n").filter((line) => line.startsWith("- The owner"))).toHaveLength(60);
  });
});
