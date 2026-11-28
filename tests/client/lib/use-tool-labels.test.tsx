/**
 * @vitest-environment jsdom
 *
 * The tool label catalog loads once per page: a transcript mounted after it
 * arrived starts with the labels instead of raw tool names.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { expect, it } from "vite-plus/test";
import type { ReactNode } from "react";
import { createShellQueryClient, ShellQueryProvider } from "@groot/shell/lib/query-client";
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
  const client = createShellQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ShellQueryProvider client={client}>{children}</ShellQueryProvider>
  );

  const failed = renderHook(() => useToolLabels(), { wrapper });
  const alongside = renderHook(() => useToolLabels(), { wrapper });
  await waitFor(() => expect(api.sent("GET", "/capabilities")).toHaveLength(1));
  failNow();
  await waitFor(() => expect(client.getQueryState(["tool-labels"])?.status).toBe("error"));
  expect(failed.result.current).toEqual({ done: {}, ask: {} });
  expect(api.sent("GET", "/capabilities")).toHaveLength(1);
  failed.unmount();
  alongside.unmount();

  api.get("/capabilities", () => catalog);
  const first = renderHook(() => useToolLabels(), { wrapper });
  await waitFor(() =>
    expect(first.result.current.ask).toEqual({ browser_navigate: "open a page" }),
  );
  first.unmount();

  const later = renderHook(() => useToolLabels(), { wrapper });
  expect(later.result.current.done).toEqual({ browser_navigate: "Opened a page" });
  expect(api.sent("GET", "/capabilities")).toHaveLength(2);
});
