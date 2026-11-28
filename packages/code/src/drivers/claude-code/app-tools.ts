import type { CodingSessionConfig, CodingSkill, CodingToolSpec } from "@tiny-agents/claude-worker";
import type { IndexedThread } from "../../contracts";
import { sessionConfig } from "./thread";

export interface AppToolPort {
  list(): Promise<CodingToolSpec[]>;
  call(
    server: string,
    tool: string,
    input: Record<string, unknown>,
  ): Promise<{ content: string; isError?: boolean }>;
}

export function callFailed(error: unknown): { content: string; isError: true } {
  return { content: error instanceof Error ? error.message : String(error), isError: true };
}

export async function sessionWithTools(
  row: IndexedThread,
  options: { tools?: AppToolPort; skills?: () => Promise<CodingSkill[]> },
): Promise<CodingSessionConfig> {
  const [tools, skills] = await Promise.all([
    options.tools?.list() ?? [],
    options.skills?.() ?? [],
  ]);
  return {
    ...sessionConfig(row),
    ...(tools.length > 0 ? { tools } : {}),
    ...(skills.length > 0 ? { skills } : {}),
  };
}
