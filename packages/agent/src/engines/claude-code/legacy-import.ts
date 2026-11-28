import { readFile, rename } from "node:fs/promises";
import { BACKGROUND_CONTEXT, type Context } from "@earendil-works/chord/context";
import type { ConversationId, Harness } from "@earendil-works/pi-durable";
import type { z } from "zod";
import { ClaudePlanDoc } from "./session";
import { legacyEntries, legacyFileSchema, type LegacySession } from "./transcript";

const ctx: Context = BACKGROUND_CONTEXT;

export async function importLegacy(
  path: string | undefined,
  harness: Harness,
  report: (error: unknown) => void,
): Promise<void> {
  if (!path) return;
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (!isMissing(error)) report(new Error(`Could not read ${path}`, { cause: error }));
    return;
  }
  const doc = await harness.snapshot(ClaudePlanDoc, ctx);
  if (!doc?.imported) {
    let parsed: z.infer<typeof legacyFileSchema>;
    try {
      parsed = legacyFileSchema.parse(JSON.parse(raw));
    } catch (error) {
      report(
        new Error(`${path} is not a Claude plan transcript file; it was left as it is`, {
          cause: error,
        }),
      );
      return;
    }
    try {
      await harness.commit(async (tx) => {
        const state = await tx.doc(ClaudePlanDoc);
        const sessions: [string, LegacySession][] = [];
        for (const [key, session] of Object.entries(parsed.sessions ?? {})) {
          const ref = Number(key);
          if (!Number.isFinite(ref)) continue;
          // eslint-disable-next-line react-doctor/async-await-in-loop
          if (await tx.conversation(ref as ConversationId)) sessions.push([key, session]);
        }
        for (const [key, session] of sessions) {
          const ref = Number(key);
          for (const entry of legacyEntries(session)) {
            // eslint-disable-next-line react-doctor/async-await-in-loop
            await tx.appendEntry(ref as ConversationId, entry);
          }
          const left = session.surface === "pi" || state.conversations[key]?.left === true;
          const claudeSessionId =
            session.claudeSessionId ?? state.conversations[key]?.claudeSessionId;
          state.conversations[key] = {
            ...(left ? { left: true } : {}),
            ...(claudeSessionId ? { claudeSessionId } : {}),
          };
        }
        state.imported = true;
      }, ctx);
    } catch (error) {
      report(new Error(`Could not import ${path}; it was left as it is`, { cause: error }));
      return;
    }
  }
  try {
    await rename(path, `${path}.imported`);
  } catch (error) {
    report(new Error(`Imported ${path} but could not rename it`, { cause: error }));
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
