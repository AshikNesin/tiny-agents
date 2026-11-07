/**
 * The Code page's thread list: every harness's flat list (subagents
 * included) as a tree, split into "working now" and "recent", optionally
 * narrowed to one repository.
 */
import type { ThreadSummary } from "./api";

export interface ListNode {
  row: ThreadSummary;
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

function repoOf(row: Pick<ThreadSummary, "repoRoot" | "cwd">): string | null {
  return row.repoRoot || row.cwd || null;
}

/** Distinct repositories (or working directories) across the rows, most recent first. */
export function repositories(rows: ThreadSummary[]): string[] {
  const seen = new Map<string, string>();
  for (const row of rows) {
    const repo = repoOf(row);
    if (!repo) continue;
    const prev = seen.get(repo);
    if (!prev || row.updatedAt > prev) seen.set(repo, row.updatedAt);
  }
  return [...seen.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([repo]) => repo);
}

const newestFirst = (a: ListNode, b: ListNode) => b.row.updatedAt.localeCompare(a.row.updatedAt);

/** Parent → children tree; a subagent whose parent is not listed stands on its own. */
export function buildTree(rows: ThreadSummary[]): ListNode[] {
  const nodes = new Map<string, ListNode>();
  for (const row of rows) {
    nodes.set(row.id, {
      row,
      children: [],
      busy: Boolean(row.working),
      unread: Boolean(row.unread),
    });
  }
  const roots: ListNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.row.parentId ? nodes.get(node.row.parentId) : undefined;
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
  rows: ThreadSummary[],
  options: { repo?: string | null; instanceId?: string | null } = {},
): ListSections {
  const scoped = rows.filter(
    (r) =>
      (!options.repo || repoOf(r) === options.repo) &&
      (!options.instanceId || r.instanceId === options.instanceId),
  );
  const tree = buildTree(scoped);
  return {
    working: tree.filter((n) => n.busy),
    recent: tree.filter((n) => !n.busy),
  };
}

/** The ancestry of a thread (root first), for the header breadcrumb. */
export function ancestry(rows: ThreadSummary[], id: string): ThreadSummary[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const chain: ThreadSummary[] = [];
  let current = byId.get(id);
  while (current && chain.length < 20) {
    chain.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}

/**
 * A multi-selection over the list (issue #148), as the archive acts on it:
 * `roots` are the selected nodes without a selected ancestor, in list order
 * (archiving one moves its subagents too, so they are not sent again), and
 * `covered` is every id they take along, selected or not.
 */
export function selectionRoots(
  trees: readonly ListNode[],
  selected: ReadonlySet<string>,
): { roots: ListNode[]; covered: Set<string> } {
  const roots: ListNode[] = [];
  const covered = new Set<string>();
  const take = (node: ListNode, depth: number): void => {
    if (depth > 20) return;
    covered.add(node.row.id);
    for (const child of node.children) take(child, depth + 1);
  };
  const walk = (node: ListNode, depth: number): void => {
    if (depth > 20) return;
    if (selected.has(node.row.id)) {
      roots.push(node);
      take(node, depth);
      return;
    }
    for (const child of node.children) walk(child, depth + 1);
  };
  for (const tree of trees) walk(tree, 0);
  return { roots, covered };
}
