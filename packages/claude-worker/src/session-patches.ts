import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type { CodingHistoryMessage } from "./coding-protocol";

export function claudeConfigDir(env: Readonly<Record<string, string | undefined>>): string {
  return env.CLAUDE_CONFIG_DIR?.trim() || path.join(env.HOME?.trim() || homedir(), ".claude");
}

async function sessionFile(configDir: string, sessionId: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(sessionId)) return null;
  const root = path.join(configDir, "projects");
  const dirs = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const file = path.join(root, dir.name, `${sessionId}.jsonl`);
    if ((await stat(file).catch(() => undefined))?.isFile()) return file;
  }
  return null;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

async function sessionPatches(
  configDir: string,
  sessionId: string,
): Promise<Map<string, Record<string, unknown>>> {
  const patches = new Map<string, Record<string, unknown>>();
  const file = await sessionFile(configDir, sessionId);
  if (!file) return patches;
  const lines = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.includes('"structuredPatch"')) continue;
    let entry: Record<string, unknown> | undefined;
    try {
      entry = record(JSON.parse(line));
    } catch {
      continue;
    }
    const result = record(entry?.toolUseResult);
    if (typeof entry?.uuid !== "string" || !Array.isArray(result?.structuredPatch)) continue;
    patches.set(entry.uuid, {
      structuredPatch: result.structuredPatch,
      ...(typeof result.filePath === "string" ? { filePath: result.filePath } : {}),
      ...(typeof result.type === "string" ? { type: result.type } : {}),
      ...(result.originalFile === null ? { originalFile: null } : {}),
    });
  }
  return patches;
}

export async function withSessionPatches(
  messages: CodingHistoryMessage[],
  configDir: string,
  sessionId: string,
): Promise<CodingHistoryMessage[]> {
  const patches = await sessionPatches(configDir, sessionId).catch(() => new Map());
  if (patches.size === 0) return messages;
  return messages.map((message) => {
    const patch = patches.get(message.uuid);
    return patch && message.tool_use_result === undefined
      ? { ...message, tool_use_result: patch }
      : message;
  });
}
