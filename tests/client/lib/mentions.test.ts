/**
 * Pure mention-token parsing and mention resolution (issue #12): these rules
 * decide when the composer opens the overlay and which bots a sent message
 * tags, so they are pinned here rather than through the ChatPane UI.
 */
import { describe, expect, it } from "vite-plus/test";
import { activeMentionToken, mentionableBots, mentionedBotIds } from "@/lib/mentions";

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

  it("matches case-sensitively as inserted", () => {
    expect(mentionedBotIds("@ada hi", BOTS, "host")).toEqual([]);
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
