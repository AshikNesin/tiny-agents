/**
 * Content rules for notification text: plain text, no links, registered
 * redactors, secret-looking runs scrubbed, ≤200 chars, and heavily scrubbed
 * fields dropped.
 */
import { afterEach, describe, expect, it } from "vite-plus/test";
import { registerRedactor, scrubText, shapeTitle } from "@groot/core/notification/scrub";

let unregister: (() => void) | undefined;
afterEach(() => unregister?.());

describe("scrubText", () => {
  it("keeps ordinary text, collapsing whitespace and controls", () => {
    expect(scrubText("Which  database\nshould I\u0000 use?")).toBe("Which database should I use?");
    expect(scrubText("   ")).toBeUndefined();
    expect(scrubText(undefined)).toBeUndefined();
  });

  it("replaces links: the notification's own url is the only link", () => {
    expect(scrubText("See https://evil.example/x?token=1 and www.other.example now please")).toBe(
      "See [link] and [link] now please",
    );
  });

  it("applies registered redactors", () => {
    unregister = registerRedactor((text) => text.replaceAll("hunter2-correct-horse", "[redacted]"));
    const out = scrubText(
      "Logged in to the staging dashboard with hunter2-correct-horse as the password",
    );
    expect(out).not.toContain("hunter2");
    expect(out).toContain("[redacted]");
  });

  it("scrubs secret-looking runs", () => {
    const text =
      "The deploy failed while calling the billing service because Authorization was rejected: Bearer abcdefghijklmnop1234 expired at noon today";
    const out = scrubText(text);
    expect(out).not.toContain("abcdefghijklmnop1234");
    expect(out).toContain("[redacted]");
  });

  it("drops a field that is mostly secrets", () => {
    expect(scrubText("key sk-live_0123456789abcdefghij")).toBeUndefined();
  });

  it("truncates to the limit", () => {
    const out = scrubText("word ".repeat(100), 50)!;
    expect([...out].length).toBeLessThanOrEqual(50);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("shapeTitle", () => {
  it("never returns an empty title", () => {
    expect(shapeTitle("\u0000\u0001")).toBe("Notification");
  });
});
