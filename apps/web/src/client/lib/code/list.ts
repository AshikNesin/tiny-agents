import type { ThreadSummary } from "./api";

export interface ListNode {
  row: ThreadSummary;
  children: ListNode[];
  busy: boolean;
  unread: boolean;
}

export interface ListGroup {
  key: string;
  label: string;
  projectId?: string;
  path?: string;
  nodes: ListNode[];
}

function repoOf(row: Pick<ThreadSummary, "repoRoot" | "cwd">): string | null {
  return row.repoRoot || row.cwd || null;
}

function lastActive(node: ListNode): string {
  return node.children.reduce((latest, child) => {
    const at = lastActive(child);
    return at > latest ? at : latest;
  }, node.row.updatedAt);
}

const newestFirst = (a: ListNode, b: ListNode) => b.row.updatedAt.localeCompare(a.row.updatedAt);

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
    if (depth > 20) return;
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

export function buildGroups(
  rows: ThreadSummary[],
  projects: ReadonlyArray<{ id: string; name: string }>,
): ListGroup[] {
  const groups = new Map<string, ListGroup>();
  for (const project of projects) {
    const key = `project:${project.id}`;
    groups.set(key, { key, label: project.name, projectId: project.id, nodes: [] });
  }
  for (const node of buildTree(rows)) {
    const projectKey = node.row.projectId ? `project:${node.row.projectId}` : null;
    if (projectKey && groups.has(projectKey)) {
      groups.get(projectKey)!.nodes.push(node);
      continue;
    }
    const path = repoOf(node.row);
    const key = path ? `folder:${path}` : "none";
    let group = groups.get(key);
    if (!group) {
      group = path
        ? { key, label: path.split("/").findLast(Boolean) ?? path, path, nodes: [] }
        : { key, label: "No folder", nodes: [] };
      groups.set(key, group);
    }
    group.nodes.push(node);
  }
  const active = new Map<string, string>();
  for (const group of groups.values()) {
    group.nodes.sort((a, b) => Number(b.busy) - Number(a.busy) || newestFirst(a, b));
    active.set(
      group.key,
      group.nodes.map(lastActive).reduce((a, b) => (b > a ? b : a), ""),
    );
  }
  return [...groups.values()].sort((a, b) =>
    (active.get(b.key) ?? "").localeCompare(active.get(a.key) ?? ""),
  );
}

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

export interface StatusSection {
  key: "working" | "needs-you" | "review" | "done";
  label: string;
  nodes: ListNode[];
}

const SECTIONS: Array<Pick<StatusSection, "key" | "label">> = [
  { key: "working", label: "Working" },
  { key: "needs-you", label: "Needs you" },
  { key: "review", label: "In review" },
  { key: "done", label: "Done" },
];

function sectionOf(node: ListNode): StatusSection["key"] {
  if (node.busy) return "working";
  const loop = node.row.pr?.loop;
  if (loop === "needs_input") return "needs-you";
  if (node.row.pr && loop !== "merged") return "review";
  return "done";
}

export function statusSections(rows: ThreadSummary[]): StatusSection[] {
  const nodes = buildTree(rows);
  return SECTIONS.map((section) => ({
    ...section,
    nodes: nodes.filter((node) => sectionOf(node) === section.key),
  })).filter((section) => section.nodes.length > 0);
}
