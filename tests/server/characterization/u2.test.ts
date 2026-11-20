import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { BotListEntry } from "../../../apps/web/src/shared/bot-list";
import { api, createTestApp } from "../helpers";
import { authToken, installFakeRuntime, resetAppTables, seedBot } from "../fixtures";

const token = await authToken("u2-owner@example.com");
const app = createTestApp();

async function entry(id: string): Promise<BotListEntry> {
  const list = await api<BotListEntry[]>(app, "/api/v1/bots", { token });
  expect(list.status).toBe(200);
  return list.body.data!.find((bot) => bot.id === id)!;
}

beforeEach(resetAppTables);
afterEach(resetAppTables);

describe("U2: the owner's own send", () => {
  it("marks the bot unread, with no reply, until the owner posts /read", async () => {
    const fake = installFakeRuntime();
    const readAt = new Date(Date.now());
    const bot = await seedBot({
      name: "Quiet",
      lastMessagePreview: "Echo: earlier",
      lastActivityAt: new Date(Date.now() - 60_000),
      lastReadAt: readAt,
    });
    expect(await entry(bot.id)).toMatchObject({ unread: false });

    vi.setSystemTime(Date.now() + 1_000);
    const sent = await api(app, `/api/v1/bots/${bot.id}/messages`, {
      method: "POST",
      json: { requestId: "u2-send-1", text: "a note to myself" },
      token,
    });
    expect(sent.status).toBe(200);
    expect(fake.submit).toHaveBeenCalledTimes(1);

    expect(await entry(bot.id)).toMatchObject({
      lastMessagePreview: "a note to myself",
      unread: true,
      replying: false,
    });

    const read = await api(app, `/api/v1/bots/${bot.id}/read`, { method: "POST", token });
    expect(read.status).toBe(200);
    expect(await entry(bot.id)).toMatchObject({ unread: false });
  });
});
