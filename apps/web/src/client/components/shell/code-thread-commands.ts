import { Code2 } from "lucide-react";
import type { CommandGroupEntry } from "@groot/shell/components/CommandPalette";
import { threadPath, type ThreadSummary } from "../../lib/code/api";

export function codeThreadGroup(
  threads: readonly ThreadSummary[] | null,
  navigate: (to: string) => void,
): CommandGroupEntry[] {
  const roots = (threads ?? []).filter((thread) => !thread.parentId);
  if (roots.length === 0) return [];
  return [
    {
      heading: "Code",
      items: roots
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((thread) => ({
          id: `code-${thread.id}`,
          label: thread.title,
          icon: Code2,
          onSelect: () => navigate(threadPath(thread.id)),
        })),
    },
  ];
}
