import type { ThreadSettings } from "../../contracts";
import { tagsOf, TINY_AGENTS_TAG, type ShelleyRow, type ShelleySettings } from "./wire";

export function descendantIds(rows: ShelleyRow[], id: string): string[] {
  const children = new Map<string, string[]>();
  for (const row of rows) {
    const parent = row.parent_conversation_id;
    if (!parent) continue;
    const list = children.get(parent) ?? [];
    list.push(row.conversation_id);
    children.set(parent, list);
  }
  const found: string[] = [];
  const seen = new Set([id]);
  const queue = [id];
  while (queue.length > 0) {
    for (const child of children.get(queue.shift()!) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      found.push(child);
      queue.push(child);
    }
  }
  return found;
}

export function ours(rows: ShelleyRow[], context: ShelleyRow[] = []): ShelleyRow[] {
  const byId = new Map<string, ShelleyRow>();
  for (const row of [...context, ...rows]) byId.set(row.conversation_id, row);
  const verdict = new Map<string, boolean>();
  const tagged = (start: ShelleyRow): boolean => {
    const path: string[] = [];
    let row: ShelleyRow | undefined = start;
    let found = false;
    while (row && !path.includes(row.conversation_id)) {
      const known = verdict.get(row.conversation_id);
      if (known !== undefined) {
        found = known;
        break;
      }
      path.push(row.conversation_id);
      if (tagsOf(row).includes(TINY_AGENTS_TAG)) {
        found = true;
        break;
      }
      row = row.parent_conversation_id ? byId.get(row.parent_conversation_id) : undefined;
    }
    for (const id of path) verdict.set(id, found);
    return found;
  };
  return rows.filter(tagged);
}

export function withAttachments(message: string, refs: string[] | undefined): string {
  const paths = (refs ?? [])
    .filter((ref) => ref.startsWith("file:/"))
    .map((ref) => `[${ref.slice(5)}]`);
  if (paths.length === 0) return message;
  return [message.trim(), paths.join(" ")].filter(Boolean).join("\n\n");
}

export function settingsOf(raw: ShelleySettings | undefined, row?: ShelleyRow): ThreadSettings {
  return {
    model: raw?.model || row?.model || null,
    effort: raw?.thinking_level || null,
    permissionMode: null,
  };
}
