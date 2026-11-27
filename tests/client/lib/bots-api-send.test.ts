import { beforeEach, describe, expect, it } from "vite-plus/test";
import { botsApi } from "@/lib/bots-api";
import { fakeApi } from "../fakes/api";

let api: ReturnType<typeof fakeApi>;

beforeEach(() => {
  api = fakeApi();
  api.post("/bots/:id/messages", () => ({ submitted: true }));
});

describe("botsApi.send", () => {
  it("posts requestId, text and mentions", async () => {
    await expect(botsApi.send("b1", "r1", "@Ada hi", ["b2"])).resolves.toEqual({ submitted: true });
    expect(api.sent("POST", "/bots/b1/messages")[0]!.body).toEqual({
      requestId: "r1",
      text: "@Ada hi",
      mentions: ["b2"],
    });
  });

  it("keeps the legacy two-field body when nothing is mentioned", async () => {
    await botsApi.send("b1", "r1", "plain hi", undefined);
    expect(api.sent("POST", "/bots/b1/messages")[0]!.body).toEqual({
      requestId: "r1",
      text: "plain hi",
    });
  });
});
