/**
 * The memory prompt section across one conversation. pi-durable re-sends a
 * section into the transcript every time its text changes, so a memory the
 * chat itself just produced (capture of this chat, or `remember` here) must
 * not re-send the whole block: the conversation already holds that fact.
 * Anything the chat cannot know (a memory from elsewhere, a removal) still
 * refreshes the block on the next request.
 */
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
  /** One request: render with what the transcript shows, and record what it would show next. */
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
    // Nothing shown yet (a new chat, or after compaction): everything, own memories too.
    const first = await render();
    expect(first).toContain("- The owner lives in Chennai.");
    expect(first).toContain("- The owner likes tea.");

    // This chat just said it: the shown block stays, nothing is re-sent.
    lines = [...lines, line("The owner prefers TypeScript.", { learnedHere: true })];
    expect(await render()).toBe(first);

    // A memory from elsewhere: the block refreshes, now with the own one too.
    lines = [...lines, line("The owner has a dog named Bruno.")];
    const second = await render();
    expect(second).toContain("- The owner has a dog named Bruno.");
    expect(second).toContain("- The owner prefers TypeScript.");

    // A shown memory goes away (forgotten, deleted, replaced): refreshed.
    lines = lines.filter((m) => !m.text.includes("tea"));
    expect(await render()).not.toContain("tea");
  });
});
