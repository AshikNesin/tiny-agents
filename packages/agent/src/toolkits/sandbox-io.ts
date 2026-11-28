import {
  SandboxTimeoutError,
  type SandboxConnection,
  type SandboxExecResult,
  type SandboxFile,
} from "@tiny-agents/sandbox";

export interface CommandResult {
  output: string;
  exitCode: number;
}

export { fail } from "./result";

export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function sandboxOrThrow(connection: SandboxConnection | undefined): SandboxConnection {
  if (!connection) throw new Error("Sandbox is not configured: set SANDBOX_HOST on the server.");
  return connection;
}

const OUTPUT_BYTES = 60_000;
export const OUTPUT_CHARS = 30_000;

function combined(result: SandboxExecResult): CommandResult {
  const text = (
    result.stdout.toString("utf8") + (result.stderr ? `\n${result.stderr}` : "")
  ).trimEnd();
  return {
    output: text.length > OUTPUT_CHARS ? text.slice(0, OUTPUT_CHARS) + "\n… (truncated)" : text,
    exitCode: result.exitCode,
  };
}

export async function execCapped(
  connection: SandboxConnection,
  command: string,
  options: { timeoutMs: number; stdin?: string; signal?: AbortSignal },
  afterTimeout = "",
): Promise<CommandResult> {
  try {
    return combined(await connection.exec(command, { ...options, maxBytes: OUTPUT_BYTES }));
  } catch (error) {
    if (error instanceof SandboxTimeoutError) {
      throw new Error(
        `Command timed out after ${Math.round(options.timeoutMs / 1000)}s.${afterTimeout}`,
        { cause: error },
      );
    }
    throw error;
  }
}

export function utf8TextOf(file: SandboxFile): string | undefined {
  return looksUtf8(trimPartialRune(file.bytes)) ? file.bytes.toString("utf8") : undefined;
}

function trimPartialRune(buffer: Buffer): Buffer {
  for (let drop = 0; drop < 4 && buffer.length - drop > 0; drop++) {
    const last = buffer[buffer.length - 1 - drop];
    const need = last < 0x80 ? 0 : last < 0xe0 ? 1 : last < 0xf0 ? 2 : 3;
    if (need === 0) return buffer.subarray(0, buffer.length - drop);
    const start = buffer.length - 1 - drop - (need - 1);
    if (start >= 0 && buffer[start] >= 0xc0) return buffer.subarray(0, start);
  }
  return buffer;
}

function looksUtf8(buffer: Buffer): boolean {
  return !buffer.toString("utf8").includes("�");
}
