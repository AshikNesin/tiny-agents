/**
 * Regression: /api/v1/capabilities returns `{ capabilities: [...] }`, but the
 * api unwraps `data` — so botsApi.capabilities() must unwrap the wrapper too.
 * In the wild this surfaced as "capabilities.filter is not a function"
 * crashing the whole React tree when the New bot dialog opened.
 */
import { describe, expect, it, vi } from "vitest";

const getMock = vi.fn();
vi.mock("@groot/shell/lib/api", () => ({
  apiClient: { get: (...args: unknown[]) => getMock(...args) },
}));

import { botsApi } from "@/lib/bots-api";

describe("botsApi.capabilities", () => {
  it("returns the array, not the { capabilities } wrapper", async () => {
    const capability = { id: "tasks", kind: "toolkit", name: "Tasks", description: "", tools: [] };
    getMock.mockResolvedValue({ capabilities: [capability] });
    await expect(botsApi.capabilities()).resolves.toEqual([capability]);
  });

  it("survives an empty response", async () => {
    getMock.mockResolvedValue({});
    await expect(botsApi.capabilities()).resolves.toEqual([]);
  });
});
