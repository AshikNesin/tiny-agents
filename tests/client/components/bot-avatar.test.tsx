/**
 * @vitest-environment jsdom
 *
 * Bot avatars are generated locally (initials on a deterministic color) so
 * contact names never leave the instance through a third-party avatar URL.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { BotAvatar, botAvatarDataUrl } from "@/components/BotAvatar";

describe("BotAvatar", () => {
  it("renders a local data URL avatar, never a third-party request", () => {
    render(<BotAvatar name="Ada Lovelace" />);
    const img = document.querySelector("img")!;
    expect(img.getAttribute("src")).toMatch(/^data:image\/svg\+xml,/);
    expect(img.getAttribute("src")).not.toContain("dicebear");
  });

  it("derives a stable avatar from the name alone", () => {
    expect(botAvatarDataUrl("Grace Hopper")).toBe(botAvatarDataUrl("Grace Hopper"));
    expect(botAvatarDataUrl("Grace Hopper")).not.toBe(botAvatarDataUrl("Alan Turing"));
  });
});
