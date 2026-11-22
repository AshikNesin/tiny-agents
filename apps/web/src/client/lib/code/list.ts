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

const groupOf = (row: ThreadSummary): Group =>
  row.status?.group ?? (row.working ? "working" : "done");

export function statusSections(rows: ThreadSummary[]): StatusSection[] {
  const newestFirst = [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return SECTIONS.map((section) => ({
    ...section,
    rows: newestFirst.filter((row) => groupOf(row) === section.key),
  })).filter((section) => section.rows.length > 0);
}

export function listOrder(sections: StatusSection[]): string[] {
  return sections.flatMap((section) => section.rows.map((row) => row.id));
}
