import type { ToolExecutionResult } from "@earendil-works/pi-durable";

export const ok = (text: string): ToolExecutionResult => ({ output: [{ type: "text", text }] });

export const fail = (text: string): ToolExecutionResult => ({
  output: [{ type: "text", text }],
  isError: true,
});
