import { randomBytes } from "node:crypto";
import type { CodingEvent, CodingToolSpec } from "./coding-protocol";
import type { CodingSdk } from "./coding-sdk";
import type { JsonSchema } from "./protocol";
import { zodShape, type SdkToolResult } from "./sdk";

export interface AppToolOutcome {
  content: string;
  isError?: boolean;
}

interface PendingCall {
  resolve: (outcome: AppToolOutcome) => void;
  cancel: () => void;
}

const APP_TOOL_TIMEOUT_MS = 10 * 60_000;

export function appToolName(spec: Pick<CodingToolSpec, "server" | "name">): string {
  return `mcp__${spec.server}__${spec.name}`;
}

export class AppToolCalls {
  private readonly calls = new Map<string, PendingCall>();

  constructor(
    private readonly publish: (event: CodingEvent) => void,
    private readonly schedule: (fn: () => void, ms: number) => () => void,
  ) {}

  call(spec: CodingToolSpec, input: Record<string, unknown>): Promise<AppToolOutcome> {
    const callId = `tc_${randomBytes(8).toString("hex")}`;
    return new Promise<AppToolOutcome>((resolve) => {
      const cancel = this.schedule(
        () =>
          this.settle(callId, {
            content: "The app did not answer this tool call in time.",
            isError: true,
          }),
        APP_TOOL_TIMEOUT_MS,
      );
      this.calls.set(callId, { resolve, cancel });
      this.publish({ type: "tool_call", callId, server: spec.server, tool: spec.name, input });
    });
  }

  settle(callId: string, outcome: AppToolOutcome): boolean {
    const pending = this.calls.get(callId);
    if (!pending) return false;
    this.calls.delete(callId);
    pending.cancel();
    pending.resolve(outcome);
    this.publish({ type: "tool_call_closed", callId });
    return true;
  }

  closeAll(outcome: AppToolOutcome): void {
    for (const id of this.calls.keys()) this.settle(id, outcome);
  }
}

export function appServers(
  specs: CodingToolSpec[],
  sdk: Pick<CodingSdk, "tool" | "createSdkMcpServer">,
  run: (spec: CodingToolSpec, args: Record<string, unknown>) => Promise<SdkToolResult>,
): {
  mcpServers?: Record<string, unknown>;
  allowedTools?: string[];
} {
  const { tool, createSdkMcpServer } = sdk;
  if (specs.length === 0 || !tool || !createSdkMcpServer) return {};
  const byServer = new Map<string, CodingToolSpec[]>();
  for (const spec of specs) byServer.set(spec.server, [...(byServer.get(spec.server) ?? []), spec]);
  const mcpServers: Record<string, unknown> = {};
  for (const [server, list] of byServer) {
    mcpServers[server] = createSdkMcpServer({
      name: server,
      version: "1.0.0",
      tools: list.map((spec) =>
        tool(spec.name, spec.description, zodShape(spec.inputSchema as JsonSchema), (args) =>
          run(spec, args),
        ),
      ),
    });
  }
  return { mcpServers, allowedTools: specs.map(appToolName) };
}
