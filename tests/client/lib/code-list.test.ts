import { describe, expect, it } from "vite-plus/test";
import { listOrder, projectGroups, statusSections } from "@/lib/code/list";
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

describe("the thread list's project groups", () => {
  const project = (id: string, name: string) => ({ id, name });

  it("put each thread under its project, needing-you first, and keep projects with no threads", () => {
    const groups = projectGroups(
      [
        row("web-done", {
          projectId: "web",
          status: { group: "done", reason: null },
        }),
        row("api-run", {
          projectId: "api",
          status: { group: "working", reason: null },
        }),
        row("web-asks", {
          projectId: "web",
          status: { group: "needs-you", reason: "asks you" },
        }),
        row("loose"),
      ],
      [project("web", "web"), project("api", "api"), project("docs", "docs")],
    );
    expect(groups.map((g) => [g.project?.name ?? null, g.rows.map((r) => r.id)])).toEqual([
      ["web", ["web-asks", "web-done"]],
      ["api", ["api-run"]],
      ["docs", []],
      [null, ["loose"]],
    ]);
    expect(listOrder(groups)).toEqual(["web-asks", "web-done", "api-run", "loose"]);
  });

  it("list a thread whose project is gone with the threads that have none", () => {
    const groups = projectGroups([row("orphan", { projectId: "gone" })], [project("web", "web")]);
    expect(groups.map((g) => [g.project?.id ?? null, g.rows.map((r) => r.id)])).toEqual([
      ["web", []],
      [null, ["orphan"]],
    ]);
  });
});
