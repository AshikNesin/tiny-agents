import { describe, expect, it } from "vite-plus/test";
import { codeThreadGroup } from "@/components/shell/code-thread-commands";
import type { ThreadSummary } from "@/lib/code/api";

const thread = (i: number) =>
  ({
    id: `demo:${i}`,
    title: `Thread ${i}`,
    updatedAt: `2026-11-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
  }) as ThreadSummary;

describe("the palette's Code threads", () => {
  it("lists every thread, so `:` finds an old one by its title", () => {
    const threads = Array.from({ length: 45 }, (_, i) => thread(i));
    const opened: string[] = [];
    const [group] = codeThreadGroup(threads, (to) => opened.push(to));
    expect(group.items).toHaveLength(45);
    group.items.find((item) => item.label === "Thread 3")!.onSelect();
    expect(opened).toEqual(["/code/t/demo%3A3"]);
  });
});
