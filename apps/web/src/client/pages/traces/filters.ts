import type { TraceEvent, TraceTurn } from "../../../shared/api/traces";

export type FilterKey = TraceEvent["type"] | `tool:${string}`;

export interface FilterCounts {
  prompt: number;
  response: number;
  thinking: number;
  tool: number;
  compaction: number;
  tools: [string, number][];
}

export function countEvents(turns: readonly TraceTurn[]): FilterCounts {
  const counts: FilterCounts = {
    prompt: 0,
    response: 0,
    thinking: 0,
    tool: 0,
    compaction: 0,
    tools: [],
  };
  const tools = new Map<string, number>();
  for (const event of turns.flatMap((turn) => turn.events)) {
    counts[event.type] += 1;
    if (event.type === "tool") tools.set(event.name, (tools.get(event.name) ?? 0) + 1);
  }
  counts.tools = [...tools].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return counts;
}

export function shows(selected: ReadonlySet<FilterKey>, event: TraceEvent): boolean {
  if (selected.size === 0) return true;
  if (selected.has(event.type)) return true;
  return event.type === "tool" && selected.has(`tool:${event.name}`);
}

export function toolDisplayName(name: string): string {
  const bare = name.replace(/^mcp__[a-z0-9-]+__/, "").replace(/_/g, " ");
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}
