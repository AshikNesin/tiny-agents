import { describe, expect, it } from "vite-plus/test";
import { parsePeerEnvelope, stripPeerEnvelope } from "@tiny-agents/agent/peer-envelope";

describe("parsePeerEnvelope", () => {
  it("parses a relayed reply", () => {
    expect(parsePeerEnvelope("**Reply from Radar:** here is the plan")).toEqual({
      kind: "reply",
      name: "Radar",
      text: "here is the plan",
    });
  });

  it("parses a relayed reply without markdown asterisks", () => {
    const parsed = parsePeerEnvelope("Reply from Radar: plain text");
    expect(parsed).toMatchObject({ kind: "reply", name: "Radar" });
  });

  it("parses a message_bot delivery", () => {
    expect(parsePeerEnvelope("**Message from Engineer (bot):** can you review this?")).toEqual({
      kind: "message",
      name: "Engineer",
      text: "can you review this?",
    });
  });

  it("parses an owner mention delivery", () => {
    expect(
      parsePeerEnvelope("[From the owner, in Engineer's chat] what do you think @Radar"),
    ).toEqual({
      kind: "mention",
      hostName: "Engineer",
      text: "what do you think @Radar",
    });
  });

  it("keeps inner lookalike lines intact — only the opening is the envelope", () => {
    const text = "**Reply from Radar:** they wrote **Message from X (bot):** inside";
    const parsed = parsePeerEnvelope(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.text).toContain("**Message from X (bot):** inside");
  });

  it("rejects owner-typed lookalikes mid-text", () => {
    expect(parsePeerEnvelope("hey Reply from Radar: cool right")).toBeNull();
    expect(parsePeerEnvelope("see [From the owner, in X's chat] below")).toBeNull();
  });

  it("rejects empty payloads — render raw instead of an empty card", () => {
    expect(parsePeerEnvelope("**Reply from Radar:**")).toBeNull();
    expect(parsePeerEnvelope("**Reply from Radar:**   ")).toBeNull();
  });

  it("rejects an owner message that merely contains an @", () => {
    expect(parsePeerEnvelope("email me at a@b.com about Reply from: things")).toBeNull();
  });

  it("strips the envelope in stripPeerEnvelope and passes unknown text through", () => {
    expect(stripPeerEnvelope("**Reply from Radar:** payload")).toBe("payload");
    expect(stripPeerEnvelope("just my own words")).toBe("just my own words");
  });

  it("payload keeps inner newlines (multiline replies)", () => {
    const parsed = parsePeerEnvelope("**Reply from Radar:** line one\n\nline two");
    expect(parsed!.text).toBe("line one\n\nline two");
  });
});
