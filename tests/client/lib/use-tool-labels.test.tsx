/**
 * @vitest-environment jsdom
 *
 * The tool label catalog loads once per page: a transcript mounted after it
 * arrived starts with the labels instead of raw tool names.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { expect, it } from "vite-plus/test";
import { botsApi } from "@/lib/bots-api";
import { useToolLabels } from "@/lib/use-tool-labels";
import type { CapabilityList } from "../../../apps/web/src/shared/api/bots";
import { ApiFailure, fakeApi } from "../fakes/api";

const catalog: CapabilityList = {
  capabilities: [
    {
      id: "browser",
      kind: "toolkit",
      name: "Browser",
      description: "",
      tools: [
        {
          name: "browser_navigate",
          label: "Opened a page",
          askLabel: "open a page",
          description: "",
        },
      ],
    },
  ],
};

it("fetches the catalog once and hands it to every later mount at once", async () => {
  const api = fakeApi();
  let failNow!: () => void;
  const held = new Promise<void>((resolve) => (failNow = resolve));
  api.get("/capabilities", async () => {
    await held;
    throw new ApiFailure(503, "offline");
  });

  const failed = renderHook(() => useToolLabels());
  await waitFor(() => expect(api.sent("GET", "/capabilities")).toHaveLength(1));
  const firstAnswer = botsApi.capabilities();
  failNow();
  await expect(firstAnswer).rejects.toThrow("offline");
  expect(failed.result.current).toEqual({ done: {}, ask: {} });
  failed.unmount();

  api.get("/capabilities", () => catalog);
  const first = renderHook(() => useToolLabels());
  await waitFor(() =>
    expect(first.result.current.ask).toEqual({ browser_navigate: "open a page" }),
  );

  const later = renderHook(() => useToolLabels());
  expect(later.result.current.done).toEqual({ browser_navigate: "Opened a page" });
  expect(api.sent("GET", "/capabilities")).toHaveLength(2);
});
