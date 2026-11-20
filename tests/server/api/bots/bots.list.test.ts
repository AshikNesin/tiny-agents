import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { bots, db } from "../../../../apps/web/src/server/db";
import {
  botListStep,
  isUnread,
  listBots,
  previewText,
  PREVIEW_CHARS,
} from "../../../../apps/web/src/server/api/bots/bots.list";
import type { ChatMessage } from "../../../../packages/agent/src/index";
import { createFakeRuntime, resetAppTables, seedBot } from "../../fixtures";

const row = (id: string) => db.query.bots.findFirst({ where: eq(bots.id, id) });

const assistant = (text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: "a1",
  role: "assistant",
  text,
  status: "done",
  createdAt: 1_700_000_000_000,
  ...extra,
});

describe("previewText", () => {
  it("shows the payload of a delivery, on one line, cut to the row's width", () => {
    expect(previewText("**Reply from Guest:** here   you\ngo")).toBe("here you go");
    expect(previewText("x".repeat(PREVIEW_CHARS + 20))).toHaveLength(PREVIEW_CHARS);
  });

  it("hints at what was attached when the send has no text", () => {
    expect(
      previewText("", [
        { uploadId: "u1", kind: "file", name: "notes.txt", mimeType: "text/plain", size: 1 },
      ]),
    ).toBe("[File] notes.txt");
    expect(
      previewText("  ", [
        { uploadId: "u1", kind: "image", name: "a.png", mimeType: "image/png", size: 1 },
        { uploadId: "u2", kind: "image", name: "b.png", mimeType: "image/png", size: 1 },
      ]),
    ).toBe("[Image] +1 more");
    expect(previewText("")).toBe("");
  });
});

describe("isUnread", () => {
  const at = (ms: number) => new Date(1_700_000_000_000 + ms);
  it("is a reply newer than the read marker, and never without a preview", () => {
    expect(isUnread({ lastReadAt: null, lastActivityAt: at(0), lastMessagePreview: "hi" })).toBe(
      true,
    );
    expect(isUnread({ lastReadAt: at(1), lastActivityAt: at(2), lastMessagePreview: "hi" })).toBe(
      true,
    );
    expect(isUnread({ lastReadAt: at(2), lastActivityAt: at(1), lastMessagePreview: "hi" })).toBe(
      false,
    );
    expect(isUnread({ lastReadAt: null, lastActivityAt: at(0), lastMessagePreview: null })).toBe(
      false,
    );
  });
});

describe("botListStep", () => {
  beforeEach(resetAppTables);
  afterEach(resetAppTables);

  const settled = (conversationId: number, messages: ChatMessage[]) => ({
    conversationId,
    chat: async () => ({ messages, busy: false, queued: [] }),
    owner: async () => undefined,
  });

  it("folds the Turn's last reply into the row, with its time", async () => {
    const bot = await seedBot({ name: "Ops", conversationId: "501" });
    await botListStep().run(settled(501, [assistant("**Done.**  All good")]));
    expect(await row(bot.id)).toMatchObject({
      lastMessagePreview: "**Done.** All good",
      lastActivityAt: new Date(1_700_000_000_000),
    });
  });

  it("shows a failed reply as one, like the transcript does", async () => {
    const bot = await seedBot({ name: "Ops", conversationId: "502" });
    await botListStep().run(
      settled(502, [assistant("", { status: "error", error: "429 rate limited" })]),
    );
    expect((await row(bot.id))?.lastMessagePreview).toBe("⚠ 429 rate limited");
  });

  it("leaves the row alone when nothing finished, and when no bot names the conversation", async () => {
    const bot = await seedBot({ name: "Ops", conversationId: "503", lastMessagePreview: "before" });
    const owner: ChatMessage = { id: "u1", role: "user", text: "hi", status: "done", createdAt: 1 };
    await botListStep().run(settled(503, [owner]));
    await botListStep().run(settled(503, [assistant("typing", { status: "streaming" })]));
    expect((await row(bot.id))?.lastMessagePreview).toBe("before");
    await expect(
      botListStep().run(settled(999, [assistant("routine output")])),
    ).resolves.toBeUndefined();
  });

  it("lists bots with what is live on the runtime", async () => {
    const bot = await seedBot({ name: "Busy", conversationId: "504", lastMessagePreview: "p" });
    const fake = createFakeRuntime();
    fake.busyConversations.mockReturnValue([504]);
    fake.pendingQuestions.mockImplementation((ref) => (Number(ref) === 504 ? 2 : 0));
    const [entry] = await listBots(fake);
    expect(entry).toMatchObject({
      id: bot.id,
      replying: true,
      questions: 2,
      approvals: 0,
      unread: true,
    });
  });
});
