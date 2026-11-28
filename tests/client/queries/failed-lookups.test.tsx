/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it } from "vite-plus/test";
import { useBotChoices } from "@/queries/bot-choices";
import { useMemoryEnabled } from "@/queries/memory";
import type { BotListEntry } from "../../../apps/web/src/shared/api/bots";
import { ApiFailure, fakeApi } from "../fakes/api";
import { AppQueryProvider } from "../query-provider";

let api: ReturnType<typeof fakeApi>;

beforeEach(() => {
  api = fakeApi();
});

it("does not report memory as on for a bot whose lookup failed", async () => {
  api.get("/bots/b1", () => {
    throw new ApiFailure(503, "offline");
  });
  const bots = [{ id: "b1" } as BotListEntry];
  const { result } = renderHook(() => useMemoryEnabled(bots), { wrapper: AppQueryProvider });
  await waitFor(() => expect(api.sent("GET", "/bots/b1")).toHaveLength(1));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(result.current).toEqual({ b1: undefined });
});

it("reports a failed bot list as an error, not as no bots", async () => {
  api.get("/bots", () => {
    throw new ApiFailure(503, "offline");
  });
  const { result } = renderHook(() => useBotChoices(), { wrapper: AppQueryProvider });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.data).toBeUndefined();
});
