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

export function listOrder(sections: StatusSection[]): string[] {
  return sections.flatMap((section) => section.rows.map((row) => row.id));
}

export const STATUS_DOT: Record<Group, string> = {
  "needs-you": "bg-warning",
  working: "bg-info animate-pulse motion-reduce:animate-none",
  review: "bg-success",
  done: "bg-muted-foreground/40",
};

export function activeThreads(
  rows: ThreadSummary[],
  limit: number,
): { shown: ThreadSummary[]; more: number } {
  const active = statusSections(rows.filter((row) => !row.parentId && !row.review))
    .filter((section) => section.key === "needs-you" || section.key === "working")
    .flatMap((section) => section.rows);
  return { shown: active.slice(0, limit), more: Math.max(0, active.length - limit) };
}

export function starterOf(row: ThreadSummary): string | null {
  if (!row.startedBy) return null;
  return row.startedBy.project ? `${row.startedBy.name} chat` : row.startedBy.name;
}

export function projectThreads(
  rows: ThreadSummary[],
  projectId: string,
  query: string,
): ThreadSummary[] {
  const words = query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      row.projectId === projectId &&
      !row.parentId &&
      !row.review &&
      (!words || `${row.title} ${row.branch ?? ""}`.toLowerCase().includes(words)),
  );
}

export function statusLine(row: ThreadSummary): string {
  if (row.status?.reason && row.status.reason !== "finished") return row.status.reason;
  const preview = row.preview?.split("\n").find((line) => line.trim());
  if (preview) return preview.trim();
  if (row.working) return "Working…";
  const starter = starterOf(row);
  return starter ? `Started by ${starter}` : (row.branch ?? "");
}
