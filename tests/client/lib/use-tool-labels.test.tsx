/**
 * @vitest-environment jsdom
 *
 * The tool label catalog loads once per page: a transcript mounted after it
 * arrived starts with the labels instead of raw tool names.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { useToolLabels } from "@/lib/use-tool-labels";

const capabilities = vi.hoisted(() => vi.fn());
vi.mock("@/lib/bots-api", () => ({ botsApi: { capabilities } }));

it("fetches the catalog once and hands it to every later mount at once", async () => {
  capabilities.mockRejectedValueOnce(new Error("offline"));
  capabilities.mockResolvedValue([
    { tools: [{ name: "browser_navigate", label: "Opened a page", askLabel: "open a page" }] },
  ]);

  // A failed load leaves the empty catalog, and the next mount retries.
  const failed = renderHook(() => useToolLabels());
  await waitFor(() => expect(capabilities).toHaveBeenCalledTimes(1));
  expect(failed.result.current).toEqual({ done: {}, ask: {} });
  failed.unmount();

  const first = renderHook(() => useToolLabels());
  await waitFor(() =>
    expect(first.result.current.ask).toEqual({ browser_navigate: "open a page" }),
  );

  const later = renderHook(() => useToolLabels());
  expect(later.result.current.done).toEqual({ browser_navigate: "Opened a page" });
  expect(capabilities).toHaveBeenCalledTimes(2);
});
