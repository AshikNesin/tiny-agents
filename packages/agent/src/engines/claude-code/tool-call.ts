import { BACKGROUND_CONTEXT, type Context } from "@earendil-works/chord/context";
import type { Harness, ToolExecutionResult } from "@earendil-works/pi-durable";
import type { ToolResultPayload } from "@tiny-agents/claude-worker";
import { gateHooksOf } from "../../approvals";
import { ranToResult, type ToolGate } from "../../gate";
import type { GateUserMessage } from "../../policy";
import { secretRedactor } from "../../redact";
import { finishedToolRow, liveToolRow, type ToolCallRow } from "../../tool-call-row";
import type { ChatToolCall, ConversationRef } from "../../types";
import type { ToolUseCall } from "./client";
import type { ClaudeSession, LiveTurn } from "./session";
import { claudeToolApi } from "./tools";
import type { ClaudeReply } from "./transcript";

const ctx: Context = BACKGROUND_CONTEXT;

export interface ToolCallHost {
  harness: () => Harness;
  gate: ToolGate;
  userMessages(ref: ConversationRef): Promise<readonly GateUserMessage[]>;
  emit(ref: ConversationRef): void;
  appendReply(ref: ConversationRef, session: ClaudeSession, reply: ClaudeReply): Promise<void>;
  ownerWait(
    ref: ConversationRef,
    live: LiveTurn,
    toolUseId: string,
    status: ChatToolCall["status"],
  ): void;
}

export async function runToolCall(
  host: ToolCallHost,
  ref: ConversationRef,
  session: ClaudeSession,
  live: LiveTurn,
  call: ToolUseCall,
): Promise<ToolResultPayload> {
  const args = asRecord(call.input);
  const row = (fields: ToolCallRow) => {
    if (live.closed) return;
    const tool: ChatToolCall = { id: call.toolUseId, name: call.name, args, ...fields };
    upsertTool(live.reply, tool);
    host.ownerWait(ref, live, call.toolUseId, tool.status);
    host.emit(ref);
  };
  const finished = (fields: ToolCallRow) => {
    row(fields);
    if (!live.closed) void host.appendReply(ref, session, live.reply);
  };
  const failed = (content: string): ToolResultPayload => {
    finished(finishedToolRow({ output: content, isError: true }));
    return { content, isError: true };
  };
  row(liveToolRow({ status: "running" }));
  if (session.permissions[call.name] === "off") return failed(`${call.name} is off for this bot.`);
  session.nextTask += 1;
  const taskId = session.nextTask;
  let published: unknown;
  const api = claudeToolApi({
    name: call.name,
    conversation: ref,
    task: taskId,
    docs: host.harness(),
    details: (value) => {
      published = value;
      row(liveToolRow({ status: "running", taskId, details: value }));
    },
  });
  const runner = session.runners.get(call.name);
  try {
    const result = await host.gate
      .run(
        {
          name: call.name,
          args,
          replaySafe: runner?.replay === "safe",
          hooks: runner ? gateHooksOf(runner) : undefined,
          api,
          context: ctx,
          answers: "memory",
          userMessages: () => host.userMessages(ref),
          instructions: async () => session.system || undefined,
          run: async () => `${ref}:${live.turnId}`,
        },
        async (inner) => {
          row(liveToolRow({ status: "running", taskId }));
          if (!runner) return unavailable(call.name);
          return ranToResult(await runner.execute(args, inner, ctx));
        },
      )
      .then(ranToResult);
    const content = resultText(result);
    finished(
      finishedToolRow({
        output: content,
        details: result.details ?? published,
        ...(result.isError ? { isError: true } : {}),
        ...(result.diagnostics ? { diagnostics: result.diagnostics } : {}),
      }),
    );
    return { content, ...(result.isError ? { isError: true } : {}) };
  } catch (error) {
    return failed(secretRedactor.scrub(error instanceof Error ? error.message : String(error)));
  }
}

function upsertTool(reply: ClaudeReply, tool: ChatToolCall): void {
  const tools = reply.toolCalls ? [...reply.toolCalls] : [];
  const index = tools.findIndex((item) => item.id === tool.id);
  if (index >= 0) tools[index] = tool;
  else tools.push(tool);
  reply.toolCalls = tools;
}

function unavailable(name: string): ToolExecutionResult {
  return {
    output: [{ type: "text", text: `${name} is not available on the Claude plan engine.` }],
    isError: true,
  };
}

function resultText(result: ToolExecutionResult): string {
  return (result.output ?? [])
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value))
    return value as Record<string, unknown>;
  return { value };
}
