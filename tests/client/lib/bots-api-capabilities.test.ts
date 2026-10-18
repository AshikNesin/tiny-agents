/**
 * Regression: /api/v1/capabilities returns `{ capabilities: [...] }`, but the
 * api unwraps `data`; so botsApi.capabilities() must unwrap the wrapper too.
 * In the wild this surfaced as "capabilities.filter is not a function"
 * crashing the whole React tree when the New bot dialog opened.
 *
 * capabilities() is memoized per session (issue #7), so each test imports a
 * fresh module to start with an empty cache.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();
vi.mock("@groot/shell/lib/api", () => ({
  apiClient: { get: (...args: unknown[]) => getMock(...args) },
}));

async function freshBotsApi() {
  vi.resetModules();
  const { botsApi } = await import("@/lib/bots-api");
  return botsApi;
}

const capability = { id: "tasks", kind: "toolkit", name: "Tasks", description: "", tools: [] };

beforeEach(() => {
  getMock.mockClear();
});

describe("botsApi.capabilities", () => {
  it("returns the array, not the { capabilities } wrapper", async () => {
    const botsApi = await freshBotsApi();
    getMock.mockResolvedValue({ capabilities: [capability] });
    await expect(botsApi.capabilities()).resolves.toEqual([capability]);
  });

  it("survives an empty response", async () => {
    const botsApi = await freshBotsApi();
    getMock.mockResolvedValue({});
    await expect(botsApi.capabilities()).resolves.toEqual([]);
  });

  it("serves every caller from one request (issue #7)", async () => {
    const botsApi = await freshBotsApi();
    getMock.mockResolvedValue({ capabilities: [capability] });
    await Promise.all([botsApi.capabilities(), botsApi.capabilities()]);
    await botsApi.capabilities();
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(getMock).toHaveBeenCalledWith("/capabilities");
  });

  it("retries after a rejection instead of caching the failure", async () => {
    const botsApi = await freshBotsApi();
    getMock.mockRejectedValueOnce(new Error("offline"));
    await expect(botsApi.capabilities()).rejects.toThrow("offline");
    getMock.mockResolvedValue({ capabilities: [capability] });
    await expect(botsApi.capabilities()).resolves.toEqual([capability]);
    expect(getMock).toHaveBeenCalledTimes(2);
  });
});
