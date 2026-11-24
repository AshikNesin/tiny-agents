import type { ThreadSummary } from "./api";

type Group = NonNullable<ThreadSummary["status"]>["group"];

export interface StatusSection {
  key: Group;
  label: string;
  rows: ThreadSummary[];
}

const SECTIONS: Array<Pick<StatusSection, "key" | "label">> = [
  { key: "needs-you", label: "Needs you" },
  { key: "working", label: "Working" },
  { key: "review", label: "In review" },
  { key: "done", label: "Done" },
];

export const groupOf = (row: ThreadSummary): Group =>
  row.status?.group ?? (row.working ? "working" : "done");

export function statusSections(rows: ThreadSummary[]): StatusSection[] {
  const newestFirst = [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return SECTIONS.map((section) => ({
    ...section,
    rows: newestFirst.filter((row) => groupOf(row) === section.key),
  })).filter((section) => section.rows.length > 0);
}

export interface ProjectGroup<P extends { id: string }> {
  project: P | null;
  rows: ThreadSummary[];
}

export function projectGroups<P extends { id: string }>(
  rows: ThreadSummary[],
  projects: P[],
): ProjectGroup<P>[] {
  const ordered = statusSections(rows).flatMap((section) => section.rows);
  const known = new Set(projects.map((project) => project.id));
  const groups: ProjectGroup<P>[] = projects.map((project) => ({
    project,
    rows: ordered.filter((row) => row.projectId === project.id),
  }));
  const loose = ordered.filter((row) => !row.projectId || !known.has(row.projectId));
  return loose.length > 0 ? [...groups, { project: null, rows: loose }] : groups;
}

export function listOrder(sections: Array<{ rows: ThreadSummary[] }>): string[] {
  return sections.flatMap((section) => section.rows.map((row) => row.id));
}
