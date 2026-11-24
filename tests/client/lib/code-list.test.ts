import { describe, expect, it } from "vite-plus/test";
import { activeThreads, listOrder, starterOf, statusSections } from "@/lib/code/list";
import type { ThreadSummary } from "@/lib/code/api";

const row = (nativeId: string, extra: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id: nativeId,
  instanceId: "fake",
  kind: "fake",
  nativeId,
  title: nativeId,
  cwd: null,
  model: null,
  parentId: null,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
  working: false,
  archived: false,
  cursor: 0,
  ...extra,
});

describe("the thread list's sections", () => {
  it("follow the status the server gave each thread, in a fixed order, newest first", () => {
    const sections = statusSections([
      row("old", { status: { group: "done", reason: null } }),
      row("merged", {
        status: { group: "done", reason: "merged" },
        updatedAt: "2026-11-02T00:00:00Z",
      }),
      row("running", { status: { group: "working", reason: "Fix CI" } }),
      row("asks", { status: { group: "needs-you", reason: "asks you" } }),
      row("open", { status: { group: "review", reason: null } }),
    ]);
    expect(sections.map((s) => [s.label, s.rows.map((r) => r.id)])).toEqual([
      ["Needs you", ["asks"]],
      ["Working", ["running"]],
      ["In review", ["open"]],
      ["Done", ["merged", "old"]],
    ]);
    expect(listOrder(sections)).toEqual(["asks", "running", "open", "merged", "old"]);
  });

  it("leave out empty sections, and place a thread with no status by whether it works", () => {
    const sections = statusSections([row("busy", { working: true }), row("idle")]);
    expect(sections.map((s) => [s.key, s.rows.map((r) => r.id)])).toEqual([
      ["working", ["busy"]],
      ["done", ["idle"]],
    ]);
  });
});

describe("the threads that are still going", () => {
  it("are the ones that need you, then the working ones, capped, with a count of the rest", () => {
    const rows = [
      row("done", { status: { group: "done", reason: null } }),
      row("run1", { status: { group: "working", reason: null } }),
      row("asks", { status: { group: "needs-you", reason: "asks you" } }),
      row("run2", { status: { group: "working", reason: null } }),
      row("open", { status: { group: "review", reason: null } }),
      row("child", { parentId: "run1", status: { group: "working", reason: null } }),
    ];
    const { shown, more } = activeThreads(rows, 2);
    expect(shown.map((r) => r.id)).toEqual(["asks", "run1"]);
    expect(more).toBe(1);
  });

  it("name who started them: a bot by name, a project chat as its chat, you as nobody", () => {
    expect(starterOf(row("a", { startedBy: { botId: "b1", name: "Ada", project: false } }))).toBe(
      "Ada",
    );
    expect(starterOf(row("b", { startedBy: { botId: "b2", name: "web", project: true } }))).toBe(
      "web chat",
    );
    expect(starterOf(row("c"))).toBeNull();
  });
});
