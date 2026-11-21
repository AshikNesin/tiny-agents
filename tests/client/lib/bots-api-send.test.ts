import { describe, expect, it, vi } from "vite-plus/test";

const postMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@groot/shell/lib/api", () => ({
  apiClient: { post: (...args: unknown[]) => postMock(...args) },
}));

import { botsApi } from "@/lib/bots-api";

describe("botsApi.send", () => {
  it("posts requestId, text and mentions", async () => {
    await botsApi.send("b1", "r1", "@Ada hi", ["b2"]);
    expect(postMock).toHaveBeenCalledWith("/bots/b1/messages", {
      requestId: "r1",
      text: "@Ada hi",
      mentions: ["b2"],
    });
  });

  it("keeps the legacy two-field body when nothing is mentioned", async () => {
    await botsApi.send("b1", "r1", "plain hi", undefined);
    expect(postMock).toHaveBeenCalledWith("/bots/b1/messages", {
      requestId: "r1",
      text: "plain hi",
      mentions: undefined,
    });
  });
});
