/**
 * The Code page's conversation list (issue #143): Shelley's flat snapshot
 * (subagents included) as a tree, split into "working now" and "recent",
 * optionally narrowed to one repository.
 */
import type { ShelleyConversation } from "./api";

export interface ListNode {
  row: ShelleyConversation;
  children: ListNode[];
  /** It or a descendant is working. */
  busy: boolean;
  /** It or a descendant is unread. */
  unread: boolean;
}

export interface ListSections {
  working: ListNode[];
  recent: ListNode[];
}

export function repoOf(row: Pick<ShelleyConversation, "git_repo_root" | "cwd">): string | null {
  return row.git_repo_root || row.cwd || null;
}

/** Distinct repositories (or working directories) across the rows, most recent first. */
export function repositories(rows: ShelleyConversation[]): string[] {
  const seen = new Map<string, string>();
  for (const row of rows) {
    const repo = repoOf(row);
    if (!repo) continue;
    const prev = seen.get(repo);
    if (!prev || row.updated_at > prev) seen.set(repo, row.updated_at);
  }
  return [...seen.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([repo]) => repo);
}

const newestFirst = (a: ListNode, b: ListNode) => b.row.updated_at.localeCompare(a.row.updated_at);

/** Parent → children tree; a subagent whose parent is not listed stands on its own. */
export function buildTree(rows: ShelleyConversation[]): ListNode[] {
  const nodes = new Map<string, ListNode>();
  for (const row of rows) {
    nodes.set(row.conversation_id, {
      row,
      children: [],
      busy: Boolean(row.working),
      unread: Boolean(row.unread),
    });
  }
  const roots: ListNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.row.parent_conversation_id
      ? nodes.get(node.row.parent_conversation_id)
      : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  const settle = (node: ListNode, depth: number): void => {
    if (depth > 20) return; // a cycle in bad data must not hang the page
    node.children.sort(newestFirst);
    for (const child of node.children) {
      settle(child, depth + 1);
      node.busy ||= child.busy;
      node.unread ||= child.unread;
    }
  };
  for (const root of roots) settle(root, 0);
  return roots.sort(newestFirst);
}

export function buildSections(
  rows: ShelleyConversation[],
  options: { repo?: string | null } = {},
): ListSections {
  const scoped = options.repo ? rows.filter((r) => repoOf(r) === options.repo) : rows;
  const tree = buildTree(scoped);
  return {
    working: tree.filter((n) => n.busy),
    recent: tree.filter((n) => !n.busy),
  };
}

/** The ancestry of a conversation (root first), for the header breadcrumb. */
export function ancestry(
  rows: ShelleyConversation[],
  conversationId: string,
): ShelleyConversation[] {
  const byId = new Map(rows.map((r) => [r.conversation_id, r]));
  const chain: ShelleyConversation[] = [];
  let current = byId.get(conversationId);
  while (current && chain.length < 20) {
    chain.unshift(current);
    current = current.parent_conversation_id ? byId.get(current.parent_conversation_id) : undefined;
  }
  return chain;
}
