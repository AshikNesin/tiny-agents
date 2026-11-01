import { describe, expect, it, vi } from "vite-plus/test";
import {
  CHAT_TITLE_MAX,
  DEFAULT_CHAT_TITLE_MODEL,
  cleanTitle,
  firstMessageTitle,
  titleExcerpt,
  titlePastChat,
} from "../../../../apps/web/src/server/api/bots/chats.title";

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

  it("asks the default lightweight model, falling back to the bot's own", async () => {
    const getModel = vi.fn((_provider: string, id: string) => ({ id }));
    const completeSimple = vi.fn().mockResolvedValue({ stopReason: "stop", content: [] });
    const input = {
      botName: "Travel",
      botModelId: "bot-model",
      messages: [{ role: "user", text: "Hi" }],
    };

    await titlePastChat("chat-1", input, {
      models: { getModel, completeSimple } as never,
      hasModel: () => true,
    });
    expect(DEFAULT_CHAT_TITLE_MODEL).toBe("custom:custom-zai-coding-plan/glm-5.3-flash");
    expect(getModel).toHaveBeenLastCalledWith("custom-zai-coding-plan", "glm-5.3-flash");

    await titlePastChat("chat-1", input, {
      models: { getModel, completeSimple } as never,
      hasModel: (id) => id === "bot-model",
    });
    expect(getModel).toHaveBeenLastCalledWith(expect.any(String), "bot-model");
  });

  it("never throws when the side-call fails", async () => {
    await expect(
      titlePastChat(
        "chat-1",
        { botName: "Travel", botModelId: "m", messages: [{ role: "user", text: "Hi" }] },
        {
          models: {
            getModel: () => ({ id: "m" }),
            completeSimple: vi.fn().mockRejectedValue(new Error("gateway down")),
          } as never,
          hasModel: () => true,
        },
      ),
    ).resolves.toBeUndefined();
  });
});
