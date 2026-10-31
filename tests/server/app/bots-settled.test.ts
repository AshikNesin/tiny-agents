import { describe, expect, it, vi } from "vite-plus/test";
import { settle } from "../../../apps/web/src/server/api/bots/bots.settled";

const state = { messages: [], busy: false, queued: [] };

describe("settle", () => {
  it("runs the steps in order and shares one transcript read", async () => {
    const readChat = vi.fn().mockResolvedValue(state);
    const order: string[] = [];
    await settle({ readChat } as never, 5, [
      { name: "a", run: async (c) => order.push(`a:${(await c.chat()) === state}`) },
      { name: "b", run: async () => order.push("b") },
      { name: "c", run: async (c) => order.push(`c:${(await c.chat()) === state}`) },
    ]);
    expect(order).toEqual(["a:true", "b", "c:true"]);
    expect(readChat).toHaveBeenCalledTimes(1);
    expect(readChat).toHaveBeenCalledWith(5);
  });

  it("never reads the transcript when no step needs it", async () => {
    const readChat = vi.fn();
    await settle({ readChat } as never, 5, [{ name: "a", run: async () => undefined }]);
    expect(readChat).not.toHaveBeenCalled();
  });

  it("tells the steps when the reply started, from the busy flip", async () => {
    const seen: (number | undefined)[] = [];
    await settle({ readChat: vi.fn() } as never, 5, [
      { name: "a", run: async (c) => seen.push(c.startedAt) },
    ]);
    await settle(
      { readChat: vi.fn() } as never,
      5,
      [{ name: "a", run: async (c) => seen.push(c.startedAt) }],
      1234,
    );
    expect(seen).toEqual([undefined, 1234]);
  });

  it("keeps going past a failed step", async () => {
    const ran: string[] = [];
    await settle({ readChat: vi.fn() } as never, 5, [
      {
        name: "boom",
        run: async () => {
          throw new Error("boom");
        },
      },
      { name: "after", run: async () => ran.push("after") },
    ]);
    expect(ran).toEqual(["after"]);
  });
});
