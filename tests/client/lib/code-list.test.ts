/**
 * The Code page list (issue #143, ADR 0011): every harness's threads as one
 * tree, subagents nested, working ones first, filtered by repository or
 * harness.
 */
import { describe, expect, it } from "vite-plus/test";
import { ancestry, buildSections, repositories } from "@/lib/code/list";
import type { ThreadSummary } from "@/lib/code/api";

const row = (id: string, extra: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id: `shelley:${id}`,
  instanceId: "shelley",
  kind: "shelley",
  nativeId: id,
  title: id,
  cwd: "/home/exedev/app",
  model: "predictable",
  parentId: null,
  createdAt: "2026-11-03T10:00:00Z",
  updatedAt: "2026-11-03T10:00:00Z",
  working: false,
  archived: false,
  cursor: 0,
  ...extra,
});

describe("Code page list", () => {
  it("nests subagents under their parent and floats anything working to the top", () => {
    const rows = [
      row("old", { updatedAt: "2026-11-01T00:00:00Z" }),
      row("parent", { updatedAt: "2026-11-03T09:00:00Z" }),
      row("child", { parentId: "shelley:parent", working: true }),
      row("grandchild", { parentId: "shelley:child", unread: true }),
      row("orphan", { parentId: "shelley:gone", updatedAt: "2026-11-03T11:00:00Z" }),
    ];
    const { working, recent } = buildSections(rows);
    expect(working.map((n) => n.row.nativeId)).toEqual(["parent"]);
    expect(working[0]!.busy && working[0]!.unread).toBe(true);
    expect(working[0]!.children[0]!.children[0]!.row.nativeId).toBe("grandchild");
    // A subagent whose parent is not listed stands on its own.
    expect(recent.map((n) => n.row.nativeId)).toEqual(["orphan", "old"]);
    expect(ancestry(rows, "shelley:grandchild").map((r) => r.nativeId)).toEqual([
      "parent",
      "child",
      "grandchild",
    ]);
  });

  it("filters by repository (most recently used first) and by harness", () => {
    const rows = [
      row("a", { repoRoot: "/repo/a", updatedAt: "2026-11-02T00:00:00Z" }),
      row("b", { repoRoot: "/repo/b", updatedAt: "2026-11-03T00:00:00Z" }),
      row("c", {
        id: "claude-code:c",
        instanceId: "claude-code",
        kind: "claude-code",
        repoRoot: "/repo/a",
        updatedAt: "2026-11-01T00:00:00Z",
      }),
    ];
    expect(repositories(rows)).toEqual(["/repo/b", "/repo/a"]);
    expect(buildSections(rows, { repo: "/repo/a" }).recent.map((n) => n.row.id)).toEqual([
      "shelley:a",
      "claude-code:c",
    ]);
    expect(buildSections(rows, { instanceId: "claude-code" }).recent.map((n) => n.row.id)).toEqual([
      "claude-code:c",
    ]);
  });
});

describe("selectionRoots", () => {
  it("acts on the topmost selected threads; their subagents go along", async () => {
    const { buildTree, selectionRoots } = await import("@/lib/code/list");
    const tree = buildTree([
      row("parent"),
      row("child", { parentId: "shelley:parent" }),
      row("grandchild", { parentId: "shelley:child" }),
      row("other"),
      row("lonely-child", { parentId: "shelley:other" }),
    ]);
    const { roots, covered } = selectionRoots(
      tree,
      new Set(["shelley:parent", "shelley:grandchild", "shelley:lonely-child"]),
    );
    expect(roots.map((n) => n.row.id).sort()).toEqual(["shelley:lonely-child", "shelley:parent"]);
    expect([...covered].sort()).toEqual([
      "shelley:child",
      "shelley:grandchild",
      "shelley:lonely-child",
      "shelley:parent",
    ]);
    expect(selectionRoots(tree, new Set()).roots).toEqual([]);
  });
});
