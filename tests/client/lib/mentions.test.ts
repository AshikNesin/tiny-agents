/**
 * Pure mention-token parsing and mention resolution (issue #12): these rules
 * decide when the composer opens the overlay and which bots a sent message
 * tags, so they are pinned here rather than through the ChatPane UI.
 */
import { describe, expect, it } from "vite-plus/test";
import {
  activeMentionToken,
  mentionableBots,
  mentionedBotIds,
  resolveMentions,
  trackPickedMentions,
} from "@/lib/mentions";

const BOTS = [
  { id: "b1", name: "Ada" },
  { id: "b2", name: "Grace" },
  { id: "b3", name: "Pi" },
  { id: "b4", name: "Pi Helper" },
];

describe("activeMentionToken", () => {
  it("finds a token at the start of the text", () => {
    expect(activeMentionToken("@ad", 3)).toEqual({ start: 0, query: "ad" });
  });

  it("finds a token right after whitespace", () => {
    expect(activeMentionToken("hey @gr", 7)).toEqual({ start: 4, query: "gr" });
  });

  it("returns an empty query for a bare @", () => {
    expect(activeMentionToken("hi @", 4)).toEqual({ start: 3, query: "" });
  });

  it("does not trigger mid-word (emails)", () => {
    expect(activeMentionToken("mail me at a@b.com", 18)).toBeNull();
    expect(activeMentionToken("a@b", 3)).toBeNull();
  });

  it("returns null with no @ at all", () => {
    expect(activeMentionToken("plain text", 5)).toBeNull();
  });

  it("returns null when the caret is before the @", () => {
    expect(activeMentionToken("hi @ada", 2)).toBeNull();
  });

  it("tracks the caret inside a longer query", () => {
    // Caret moved back one character: the query is the text up to it.
    expect(activeMentionToken("hi @ada", 6)).toEqual({ start: 3, query: "ad" });
  });

  it("stops at the nearest preceding @ only", () => {
    // The caret sits in the second token; the first (already inserted)
    // mention does not interfere.
    expect(activeMentionToken("@Ada what @pi", 14)).toEqual({ start: 10, query: "pi" });
  });

  it("returns null for a caret at the very start", () => {
    expect(activeMentionToken("@ada", 0)).toBeNull();
  });
});

describe("mentionableBots", () => {
  it("excludes the host bot", () => {
    expect(mentionableBots(BOTS, "b1").map((b) => b.id)).toEqual(["b2", "b3", "b4"]);
  });

  it("keeps every bot for an unknown host", () => {
    expect(mentionableBots(BOTS, "other")).toHaveLength(4);
  });
});

describe("mentionedBotIds", () => {
  it("resolves a single mention", () => {
    expect(mentionedBotIds("@Ada hello", BOTS, "host")).toEqual(["b1"]);
  });

  it("requires the @ prefix", () => {
    expect(mentionedBotIds("Ada hello", BOTS, "host")).toEqual([]);
  });

  it("requires whitespace before the @", () => {
    expect(mentionedBotIds("email a@Ada.com", BOTS, "host")).toEqual([]);
  });

  it("rejects names that run into more word characters", () => {
    expect(mentionedBotIds("@Adazine hi", BOTS, "host")).toEqual([]);
  });

  it("keeps a mention when more text follows the name", () => {
    // The autocomplete inserts "@Name "; the user may keep typing.
    expect(mentionedBotIds("@Ada Lovelace hi", BOTS, "host")).toEqual(["b1"]);
  });

  it("falls back to case-insensitive for a hand-typed tag", () => {
    // Exact case still wins; "@ada" still reaches "Ada" instead of silently
    // dropping the tag.
    expect(mentionedBotIds("@ada hi", BOTS, "host")).toEqual(["b1"]);
    expect(mentionedBotIds("@Ada hi", BOTS, "host")).toEqual(["b1"]);
  });

  it("collects multiple mentions in text order", () => {
    expect(mentionedBotIds("@Grace tell @Ada", BOTS, "host")).toEqual(["b2", "b1"]);
  });

  it("accepts punctuation after a space-delimited name", () => {
    expect(mentionedBotIds("@Ada, please", BOTS, "host")).toEqual(["b1"]);
  });

  it("dedupes repeated mentions of the same bot", () => {
    expect(mentionedBotIds("@Ada @Ada", BOTS, "host")).toEqual(["b1"]);
  });

  it("excludes the host bot", () => {
    expect(mentionedBotIds("@Ada and @Pi", BOTS, "b3")).toEqual(["b1"]);
  });

  it("never matches the host even when text names it", () => {
    expect(mentionedBotIds("@Pi", BOTS, "b3")).toEqual([]);
  });

  it("prefers the longer name at the same @ position", () => {
    expect(mentionedBotIds("@Pi Helper hi", BOTS, "host")).toEqual(["b4"]);
    expect(mentionedBotIds("@Pi hi", BOTS, "host")).toEqual(["b3"]);
  });

  it("finds a mention after a newline", () => {
    expect(mentionedBotIds("line one\n@Ada", BOTS, "host")).toEqual(["b1"]);
  });

  it("returns nothing for empty bot names", () => {
    expect(mentionedBotIds("@ hi", [{ id: "x", name: "" }], "host")).toEqual([]);
  });

  it("escapes regex metacharacters in names", () => {
    expect(mentionedBotIds("call @C++ bot", [{ id: "c", name: "C++" }], "host")).toEqual(["c"]);
    expect(mentionedBotIds("call @C bot", [{ id: "c", name: "C++" }], "host")).toEqual([]);
  });
});

// Older data can hold two bots with one name (issue #80): the autocomplete
// pick, not the text, says which one is meant.
const TWINS = [
  { id: "e1", name: "Echo" },
  { id: "e2", name: "Echo" },
  { id: "b1", name: "Ada" },
];

describe("resolveMentions", () => {
  it("sends a picked mention to the bot picked, not the first with that name", () => {
    const picked = [{ start: 0, botId: "e2", name: "Echo" }];
    expect(resolveMentions("@Echo ping", TWINS, "host", picked)).toEqual({
      ids: ["e2"],
      ambiguous: [],
    });
  });

  it("refuses a typed name several bots share instead of picking one", () => {
    expect(resolveMentions("@Echo ping @Ada", TWINS, "host")).toEqual({
      ids: ["b1"],
      ambiguous: ["Echo"],
    });
    // A pick elsewhere does not settle another, typed, occurrence.
    const picked = [{ start: 0, botId: "e1", name: "Echo" }];
    expect(resolveMentions("@Echo and @Echo", TWINS, "host", picked)).toEqual({
      ids: ["e1"],
      ambiguous: ["Echo"],
    });
  });

  it("falls back to name matching once the picked text was edited", () => {
    // "@Echo" became "@Echoes": not a mention of anyone.
    const picked = [{ start: 0, botId: "e1", name: "Echo" }];
    expect(resolveMentions("@Echoes @Ada", TWINS, "host", picked)).toEqual({
      ids: ["b1"],
      ambiguous: [],
    });
  });

  it("ignores a pick of the host or of a bot no longer in the roster", () => {
    const picked = [
      { start: 0, botId: "host", name: "Echo" },
      { start: 6, botId: "gone", name: "Ada" },
    ];
    expect(resolveMentions("@Echo @Ada", [{ id: "b1", name: "Ada" }], "host", picked)).toEqual({
      ids: ["b1"],
      ambiguous: [],
    });
  });

  it("lets a pick beat a longer typed name at the same @", () => {
    const picked = [{ start: 0, botId: "b3", name: "Pi" }];
    expect(mentionedBotIds("@Pi Helper", BOTS, "host", picked)).toEqual(["b3"]);
  });

  it("keeps text order and dedupes across picked and typed mentions", () => {
    const picked = [{ start: 10, botId: "e1", name: "Echo" }];
    expect(mentionedBotIds("@Ada tell @Echo and @Ada", TWINS, "host", picked)).toEqual([
      "b1",
      "e1",
    ]);
  });
});

describe("trackPickedMentions", () => {
  const pick = { start: 3, botId: "e1", name: "Echo" };

  it("keeps a pick when the text changes after it", () => {
    expect(trackPickedMentions("hi @Echo ", "hi @Echo there", [pick])).toEqual([pick]);
  });

  it("shifts a pick when the text changes before it", () => {
    expect(trackPickedMentions("hi @Echo ", "oh hi @Echo ", [pick])).toEqual([
      { ...pick, start: 6 },
    ]);
    expect(trackPickedMentions("hi @Echo ", "@Echo ", [pick])).toEqual([{ ...pick, start: 0 }]);
  });

  it("drops a pick whose text the edit touches", () => {
    expect(trackPickedMentions("hi @Echo ", "hi @Ecbo ", [pick])).toEqual([]);
    expect(trackPickedMentions("hi @Echo ", "", [pick])).toEqual([]);
  });
});
