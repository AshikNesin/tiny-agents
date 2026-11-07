import { describe, expect, it, vi } from "vite-plus/test";
import {
  CHAT_TITLE_MAX,
  cleanTitle,
  firstMessageTitle,
  titleExcerpt,
  titlePastChat,
} from "../../../../apps/web/src/server/api/bots/chats.title";
import type { SideCaller } from "../../../../apps/web/src/server/api/bots/side-call";

describe("past-chat titles (issue #101)", () => {
  it("takes the first owner message, on one line and capped", () => {
    expect(
      firstMessageTitle([
        { role: "assistant", text: "Hi! How can I help?" },
        { role: "user", text: "   " },
        { role: "user", text: "Plan a\n\nweekend in   Goa" },
      ]),
    ).toBe("Plan a weekend in Goa");
    expect(firstMessageTitle([{ role: "user", text: "x".repeat(200) }])).toHaveLength(
      CHAT_TITLE_MAX,
    );
    expect(firstMessageTitle([{ role: "assistant", text: "Only me" }])).toBeNull();
  });

  it("cleans the model's answer into a bare title", () => {
    expect(cleanTitle('"Goa trip planning."')).toBe("Goa trip planning");
    expect(cleanTitle("Title: **Visa checklist**\nBecause the owner asked…")).toBe(
      "Visa checklist",
    );
    expect(cleanTitle("<think>hmm</think>\nBudget review")).toBe("Budget review");
    expect(cleanTitle("   \n ")).toBeNull();
  });

  it("builds an excerpt of owner turns and replies, skipping failed replies", () => {
    const excerpt = titleExcerpt(
      [
        { role: "user", text: "Find flights" },
        { role: "assistant", text: "Boom", status: "error" },
        { role: "assistant", text: "Here are three." },
        { role: "marker", text: "" },
      ],
      "Travel",
    );
    expect(excerpt).toBe("Owner: Find flights\nTravel: Here are three.");
  });

  const input = {
    botName: "Travel",
    botModelId: "bot-model",
    messages: [
      { role: "user", text: "Find flights to Goa" },
      { role: "assistant", text: "Here are three." },
    ],
  };

  it("asks the side-caller for the title model, falling back to the bot's own", async () => {
    const complete = vi.fn<SideCaller["complete"]>().mockResolvedValue(undefined);
    await titlePastChat("chat-1", input, { sideCaller: { complete } });
    expect(complete).toHaveBeenLastCalledWith(
      expect.objectContaining({
        role: "chat_title",
        botModelId: "bot-model",
        user: "Conversation:\nOwner: Find flights to Goa\nTravel: Here are three.\n\nTitle:",
        label: "Chat title",
      }),
    );
  });

  it("makes no call for a chat with nothing said, and never throws", async () => {
    const complete = vi.fn<SideCaller["complete"]>().mockRejectedValue(new Error("boom"));
    await titlePastChat("chat-1", { ...input, messages: [] }, { sideCaller: { complete } });
    expect(complete).not.toHaveBeenCalled();
    await expect(
      titlePastChat("chat-1", input, { sideCaller: { complete } }),
    ).resolves.toBeUndefined();
  });
});
