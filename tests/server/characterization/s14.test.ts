/**
 * Characterization of behavior-register row S14: `resolveAttachments` accepts
 * any existing upload id; ownership is enforced only by the route guard.
 * Preserve: this pins today's behavior, quirk included; change it only with a
 * signed-off register row.
 *
 * `resolveAttachments` (uploads.attach.ts) checks only that each id exists. It
 * takes no viewer and no bot, so an upload another user made, first sent in
 * another bot's chat, resolves like any other. `POST /bots/:id/messages`
 * guards with `canReachUpload` before calling it; the service layer does not.
 */
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { db, uploads } from "../../../apps/web/src/server/db";
import { resolveAttachments } from "../../../apps/web/src/server/api/uploads/uploads.attach";
import { resetAppTables, seedBot } from "../fixtures";

describe("S14: resolveAttachments has no ownership check", () => {
  beforeEach(resetAppTables);
  afterEach(resetAppTables);

  it("resolves an upload made by another user and sent in another bot's chat", async () => {
    const elsewhere = await seedBot({ name: "Someone else's bot", conversationId: "9401" });
    const [upload] = await db
      .insert(uploads)
      .values({
        kind: "image",
        name: "private.png",
        mimeType: "image/png",
        size: 2048,
        width: 10,
        height: 20,
        storageKey: "chat/s14/original",
        uploadedBy: 4242,
        botId: elsewhere.id,
      })
      .returning();

    const resolved = await resolveAttachments(
      { text: "look at this", attachments: [upload!.id] },
      false,
    );

    expect(resolved.attachments).toEqual([
      {
        uploadId: upload!.id,
        kind: "image",
        name: "private.png",
        mimeType: "image/png",
        size: 2048,
        width: 10,
        height: 20,
      },
    ]);
    expect(resolved.text).toContain(`[image attached: private.png, 10x20 (${upload!.id})]`);
  });

  it("still rejects an id that does not exist (the only check it makes)", async () => {
    await expect(
      resolveAttachments({ text: "x", attachments: ["no-such-upload"] }, false),
    ).rejects.toMatchObject({ statusCode: 404, message: 'Unknown attachment "no-such-upload"' });
  });
});
