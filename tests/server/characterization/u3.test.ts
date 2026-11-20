import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { users } from "@groot/core/database/schema";
import type { AttachmentRef, ChatMessage } from "../../../packages/agent/src/index";
import { botListStep, previewText } from "../../../apps/web/src/server/api/bots/bots.list";
import { sendMessage } from "../../../apps/web/src/server/api/bots/chats.service";
import { botGuests, bots, db, guests } from "../../../apps/web/src/server/db";
import { installFakeRuntime, resetAppTables, seedBot } from "../fixtures";

const row = (id: string) => db.query.bots.findFirst({ where: eq(bots.id, id) });
const createdUsers: number[] = [];

async function user(name: string): Promise<number> {
  const [created] = await db
    .insert(users)
    .values({ email: `${randomUUID()}@example.com`, password: "!", name })
    .returning();
  createdUsers.push(created!.id);
  return created!.id;
}

beforeEach(resetAppTables);
afterEach(async () => {
  await resetAppTables();
  if (createdUsers.length > 0) {
    await db.delete(users).where(inArray(users.id, createdUsers.splice(0)));
  }
});

describe("U3: the sidebar preview", () => {
  it("in a shared chat, carries the sender's `Name: ` prefix, the owner's own sends included", async () => {
    const fake = installFakeRuntime();
    const owner = await user("Olga");
    const guest = await user("Gus");
    await db.insert(guests).values({ userId: guest });
    const bot = await seedBot({ name: "Shared" });
    await db.insert(botGuests).values({ botId: bot.id, userId: guest });

    await sendMessage(bot.id, { requestId: "g1", text: "hello all" }, undefined, guest);
    expect((await row(bot.id))?.lastMessagePreview).toBe("Gus: hello all");

    await sendMessage(bot.id, { requestId: "o1", text: "hi Gus" }, undefined, owner);
    expect((await row(bot.id))?.lastMessagePreview).toBe("Olga: hi Gus");
    expect(fake.submit.mock.calls.map(([, input]) => input.text)).toEqual([
      "Gus: hello all",
      "Olga: hi Gus",
    ]);
  });

  it("is cleared to null by a reply whose last assistant message is tool calls only", async () => {
    const bot = await seedBot({
      name: "Ops",
      conversationId: "7301",
      lastMessagePreview: "Echo: earlier",
    });
    const toolOnly: ChatMessage = {
      id: "a2",
      role: "assistant",
      text: "",
      status: "done",
      createdAt: Date.now(),
      toolCalls: [{ id: "c1", name: "create_task", args: { title: "x" }, status: "done" }],
    };
    await botListStep().run({
      conversationId: 7301,
      chat: async () => ({ messages: [toolOnly], busy: false, queued: [] }),
      owner: async () => undefined,
    });
    expect(await row(bot.id)).toMatchObject({
      lastMessagePreview: null,
      lastActivityAt: new Date(Date.now()),
    });
  });

  it("hints at images with a count of every attachment, but only when two or more are images", () => {
    const image = (name: string): AttachmentRef => ({
      uploadId: name,
      kind: "image",
      name,
      mimeType: "image/png",
      size: 1,
    });
    const file = (name: string): AttachmentRef => ({
      uploadId: name,
      kind: "file",
      name,
      mimeType: "text/plain",
      size: 1,
    });
    expect(previewText("", [image("a.png"), image("b.png"), file("c.txt")])).toBe(
      "[Image] +2 more",
    );
    expect(previewText("", [image("a.png"), file("b.txt"), file("c.txt")])).toBe("[Image] a.png");
    expect(previewText("", [file("a.txt"), image("b.png"), image("c.png")])).toBe("[File] a.txt");
  });
});
