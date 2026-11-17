/**
 * The Code page list (issue #143, ADR 0011): every harness's threads as one
 * tree, subagents nested, working ones first, grouped by project, then by
 * repository or folder.
 */
import { describe, expect, it } from "vite-plus/test";
import { ancestry, buildGroups, statusSections } from "@/lib/code/list";
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
  it("nests subagents under their parent and floats anything working to the top of its group", () => {
    const rows = [
      row("old", { updatedAt: "2026-11-01T00:00:00Z" }),
      row("parent", { updatedAt: "2026-11-03T09:00:00Z" }),
      // A subagent stays under its parent, even working in another directory.
      row("child", { parentId: "shelley:parent", working: true, cwd: "/tmp/elsewhere" }),
      row("grandchild", { parentId: "shelley:child", unread: true }),
      row("orphan", { parentId: "shelley:gone", updatedAt: "2026-11-03T11:00:00Z" }),
    ];
    const groups = buildGroups(rows, []);
    expect(groups.map((g) => g.label)).toEqual(["app"]);
    const nodes = groups[0]!.nodes;
    expect(nodes.map((n) => n.row.nativeId)).toEqual(["parent", "orphan", "old"]);
    expect(nodes[0]!.busy && nodes[0]!.unread).toBe(true);
    expect(nodes[0]!.children[0]!.children[0]!.row.nativeId).toBe("grandchild");
    expect(ancestry(rows, "shelley:grandchild").map((r) => r.nativeId)).toEqual([
      "parent",
      "child",
      "grandchild",
    ]);
  });

  it("groups by project, then by repository or folder, the most recently active first", () => {
    const rows = [
      row("a", { repoRoot: "/repo/a", cwd: "/repo/a/src", updatedAt: "2026-11-02T00:00:00Z" }),
      row("b", { repoRoot: "/repo/b", updatedAt: "2026-11-01T00:00:00Z" }),
      row("p", {
        projectId: "p1",
        cwd: "/home/exedev/tiny-agents-code/o--site/worktrees/x",
        updatedAt: "2026-11-03T00:00:00Z",
      }),
      row("loose", { cwd: null, updatedAt: "2026-10-01T00:00:00Z" }),
    ];
    const groups = buildGroups(rows, [
      { id: "p1", name: "site" },
      { id: "p2", name: "idle" },
    ]);
    expect(groups.map((g) => [g.key, g.label, g.nodes.map((n) => n.row.nativeId)])).toEqual([
      ["project:p1", "site", ["p"]],
      ["folder:/repo/a", "a", ["a"]],
      ["folder:/repo/b", "b", ["b"]],
      ["none", "No folder", ["loose"]],
      // A project with no thread yet comes last, ready to start one in.
      ["project:p2", "idle", []],
    ]);
    expect(groups[1]!.path).toBe("/repo/a");
    expect(groups[0]!.projectId).toBe("p1");
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

describe("Threads screen sections", () => {
  it("sorts a project's threads into Working, Needs you, In review and Done, newest first", () => {
    const sections = statusSections([
      row("done-old", { updatedAt: "2026-11-01T00:00:00Z" }),
      row("merged", { pr: { number: 7, loop: "merged" }, updatedAt: "2026-11-02T00:00:00Z" }),
      row("running", { working: true }),
      row("blocked", { pr: { number: 9, loop: "needs_input" } }),
      row("review", { pr: { number: 8, loop: "green" } }),
      row("sub", { parentId: "shelley:running" }),
    ]);
    expect(sections.map((s) => [s.key, s.nodes.map((n) => n.row.nativeId)])).toEqual([
      ["working", ["running"]],
      ["needs-you", ["blocked"]],
      ["review", ["review"]],
      ["done", ["merged", "done-old"]],
    ]);
  });

  it("leaves out empty sections", () => {
    expect(statusSections([row("a")]).map((s) => s.key)).toEqual(["done"]);
  });
});
