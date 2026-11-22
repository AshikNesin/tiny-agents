import { describe, expect, it } from "vite-plus/test";
import { listOrder, statusSections } from "@/lib/code/list";
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
