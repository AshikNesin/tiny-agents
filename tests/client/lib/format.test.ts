import { describe, expect, it } from "vite-plus/test";
import { formatCost, formatDuration, formatTokens, hostOf } from "@/lib/format";

describe("formatDuration", () => {
  it.each([
    [0, "0ms"],
    [340.4, "340ms"],
    [850, "850ms"],
    [999.6, "1.0s"],
    [1_000, "1.0s"],
    [1_234, "1.2s"],
    [59_500, "59.5s"],
    [59_960, "1m 0s"],
    [61_000, "1m 1s"],
    [119_600, "2m 0s"],
    [3_600_000, "1h 0m"],
    [90_061_000, "25h 1m"],
  ])("writes %d ms as %s", (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  it.each([
    [0, "0s"],
    [850, "1s"],
    [1_000, "1s"],
    [40_000, "40s"],
    [59_500, "1m 0s"],
    [61_000, "1m 1s"],
    [3_600_000, "1h 0m"],
    [90_061_000, "25h 1m"],
  ])("writes %d ms to the second as %s", (ms, expected) => {
    expect(formatDuration(ms, { precision: "seconds" })).toBe(expected);
  });
});

describe("formatTokens", () => {
  it.each([
    [0, "0"],
    [999, "999"],
    [1_000, "1K"],
    [1_500, "1.5K"],
    [12_345, "12K"],
    [200_000, "200K"],
    [1_048_576, "1M"],
    [1_250_000, "1.3M"],
  ])("writes %d tokens as %s", (tokens, expected) => {
    expect(formatTokens(tokens)).toBe(expected);
  });
});

describe("formatCost", () => {
  it.each([
    [0, "$0.00"],
    [0.0004, "<$0.001"],
    [0.004, "$0.004"],
    [0.05, "$0.05"],
    [1.5, "$1.50"],
    [12.345, "$12.35"],
  ])("writes %d dollars as %s", (usd, expected) => {
    expect(formatCost(usd)).toBe(expected);
  });
});

describe("hostOf", () => {
  it.each([
    ["https://api.example.com/v1", "api.example.com"],
    ["http://localhost:11434", "localhost:11434"],
    ["not a url", "not a url"],
  ])("reads the host of %s as %s", (url, expected) => {
    expect(hostOf(url)).toBe(expected);
  });
});
