/**
 * @vitest-environment jsdom
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { BotAvatar } from "@/components/BotAvatar";

describe("BotAvatar", () => {
  it("shows the DiceBear gaze illustration seeded by the bot's name", () => {
    render(<BotAvatar name="R&D / Ops" />);
    expect(document.querySelector("img")!.getAttribute("src")).toBe(
      "https://api.dicebear.com/10.x/gaze/svg?seed=R%26D%20%2F%20Ops",
    );
  });
});
