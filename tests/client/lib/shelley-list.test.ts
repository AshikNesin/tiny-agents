import { describe, expect, it } from "vite-plus/test";
import { ancestry, buildSections, repositories } from "@/lib/shelley/list";
import type { ShelleyConversation } from "@/lib/shelley/api";
import { queuedMessages } from "@/lib/shelley/api";

const row = (id: string, extra: Partial<ShelleyConversation> = {}): ShelleyConversation => ({
  conversation_id: id,
  slug: id,
  cwd: "/home/exedev/app",
  model: "predictable",
  created_at: "2026-11-03T10:00:00Z",
  updated_at: "2026-11-03T10:00:00Z",
  parent_conversation_id: null,
  working: false,
  ...extra,
});

describe("Code page list (issue #143)", () => {
  it("nests subagents under their parent and floats anything working to the top", () => {
    const rows = [
      row("old", { updated_at: "2026-11-01T00:00:00Z" }),
      row("parent", { updated_at: "2026-11-03T09:00:00Z" }),
      row("child", { parent_conversation_id: "parent", working: true }),
      row("grandchild", { parent_conversation_id: "child", unread: true }),
      row("orphan", { parent_conversation_id: "gone", updated_at: "2026-11-03T11:00:00Z" }),
    ];
    const { working, recent } = buildSections(rows);
    expect(working.map((n) => n.row.conversation_id)).toEqual(["parent"]);
    expect(working[0].busy && working[0].unread).toBe(true);
    expect(working[0].children[0].children[0].row.conversation_id).toBe("grandchild");
    // A subagent whose parent is not listed stands on its own.
    expect(recent.map((n) => n.row.conversation_id)).toEqual(["orphan", "old"]);
    expect(ancestry(rows, "grandchild").map((r) => r.conversation_id)).toEqual([
      "parent",
      "child",
      "grandchild",
    ]);
  });

  it("filters by repository, most recently used first", () => {
    const rows = [
      row("a", { git_repo_root: "/repo/a", updated_at: "2026-11-02T00:00:00Z" }),
      row("b", { git_repo_root: "/repo/b", updated_at: "2026-11-03T00:00:00Z" }),
    ];
    expect(repositories(rows)).toEqual(["/repo/b", "/repo/a"]);
    expect(
      buildSections(rows, { repo: "/repo/a" }).recent.map((n) => n.row.conversation_id),
    ).toEqual(["a"]);
  });

  it("reads queued messages, telling subagent reports from the owner's", () => {
    const queued = JSON.stringify([
      {
        id: "q1",
        created_at: "x",
        llm: { Content: [{ Type: 2, Text: "then update the changelog" }] },
      },
      {
        id: "q2",
        llm: { Content: [{ Type: 2, Text: "Done." }] },
        user_data: { sender_slug: "run-tests", sender_relationship: "subagent" },
      },
    ]);
    expect(queuedMessages({ queued_messages: queued })).toEqual([
      { id: "q1", text: "then update the changelog", createdAt: "x" },
      { id: "q2", text: "Done.", createdAt: "", fromSubagent: "run-tests" },
    ]);
    expect(queuedMessages({ queued_messages: "not json" })).toEqual([]);
  });
});
