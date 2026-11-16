/**
 * Edit and Write patches for a session's history. Live SDK messages carry
 * each tool's structured result (`tool_use_result`, with `structuredPatch`
 * hunks and real line numbers); `getSessionMessages` leaves it out. Claude
 * Code keeps it in the session's own file as `toolUseResult`, so history
 * reads it back from there and a reload draws the diff the live stream drew,
 * instead of a whole-string `@@ -1,n` hunk rebuilt from the tool's input.
 *
 * Best effort: no file, or a line that does not parse, leaves history as
 * `getSessionMessages` returned it.
 */
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type { CodingHistoryMessage } from "./coding-protocol";

/** Where Claude Code keeps its sessions (`CLAUDE_CONFIG_DIR`, else `~/.claude`). */
export function claudeConfigDir(env: Readonly<Record<string, string | undefined>>): string {
  return env.CLAUDE_CONFIG_DIR?.trim() || path.join(env.HOME?.trim() || homedir(), ".claude");
}

/** `<config>/projects/<the cwd, as Claude Code names it>/<session>.jsonl`; found by name. */
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

/**
 * Each tool-result entry's patch, by the entry's uuid: the hunks, the path
 * and whether the file was created. The original file's content is dropped
 * (it can be megabytes, and only its absence matters).
 */
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

/** History with each tool result's patch put back where the live stream had it. */
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
