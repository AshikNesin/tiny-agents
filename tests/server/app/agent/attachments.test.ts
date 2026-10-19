/** Attachment entries (issue #17): chat.user entries carry attachment refs. */
import { describe, expect, it } from "vite-plus/test";
import type { EntryRecord } from "@earendil-works/pi-durable";
import { chatState, CHAT_USER_ENTRY } from "../../../../packages/agent/src/index";
import type { RawChat } from "../../../../packages/agent/src/index";

const attachment = {
  uploadId: "u1",
  kind: "image",
  name: "screenshot.png",
  mimeType: "image/png",
  size: 12_345,
  width: 800,
  height: 600,
};

function chatUserEntry(id: number, text: string, attachments: unknown): EntryRecord {
  return {
    id,
    conversationId: 1,
    kind: CHAT_USER_ENTRY,
    model: [{ role: "user", content: text, timestamp: id * 1_000 }],
    data: { attachments },
  } as unknown as EntryRecord;
}

function rawChat(entries: readonly EntryRecord[]): RawChat {
  return { entries, busy: false, unanswered: new Map() };
}

describe("chat.user entries", () => {
  it("surface attachments on the derived user message", () => {
    const state = chatState(rawChat([chatUserEntry(1, "what is this?", [attachment])]));
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].role).toBe("user");
    expect(state.messages[0].attachments).toEqual([attachment]);
  });

  it("keep the message visible with empty text (image-only send)", () => {
    const state = chatState(rawChat([chatUserEntry(2, "", [attachment])]));
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].text).toBe("");
    expect(state.messages[0].attachments).toEqual([attachment]);
  });

  it("drops malformed attachment rows instead of failing the transcript", () => {
    const state = chatState(
      rawChat([
        chatUserEntry(3, "hi", [
          attachment,
          { uploadId: 7, kind: "nope", name: "", mimeType: "", size: "big" },
          null,
        ]),
      ]),
    );
    expect(state.messages[0].attachments).toEqual([attachment]);
  });

  it("renders no attachments field when the entry carries none", () => {
    const state = chatState(rawChat([chatUserEntry(4, "plain", [])]));
    expect(state.messages[0].attachments).toBeUndefined();
  });
});
