import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { describe, expect, it } from "vite-plus/test";
import {
  createMemoryCapability,
  type MemoryLine,
  type MemoryStore,
} from "../../../../packages/agent/src/index";

const line = (text: string, extra: Partial<MemoryLine> = {}): MemoryLine => ({
  text,
  category: "fact",
  until: null,
  createdAt: `2026-11-0${text.length % 9}T00:00:00.000Z`,
  ...extra,
});

function sectionOver(store: MemoryStore) {
  const section = createMemoryCapability(store).extension.sections!.find(
    (s) => s.key === "memory",
  )!;
  let shown: Record<string, string> = {};
  return async () => {
    const text = await section.render({ conversationId: 7, shown } as never, BACKGROUND_CONTEXT);
    shown = text === undefined ? {} : { memory: `<memory>\n${text}\n</memory>` };
    return text;
  };
}

describe("memory section", () => {
  it("keeps the shown block for this chat's own new memories, and refreshes for anything else", async () => {
    let lines = [
      line("The owner lives in Chennai."),
      line("The owner likes tea.", { learnedHere: true }),
    ];
    const render = sectionOver({ list: async () => lines });
    const first = await render();
    expect(first).toContain("- The owner lives in Chennai.");
    expect(first).toContain("- The owner likes tea.");

    lines = [...lines, line("The owner prefers TypeScript.", { learnedHere: true })];
    expect(await render()).toBe(first);

    lines = [...lines, line("The owner has a dog named Bruno.")];
    const second = await render();
    expect(second).toContain("- The owner has a dog named Bruno.");
    expect(second).toContain("- The owner prefers TypeScript.");

    lines = lines.filter((m) => !m.text.includes("tea"));
    expect(await render()).not.toContain("tea");
  });
});
