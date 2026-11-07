/**
 * What a tool keeps in pi-durable (task memos, task document fields) is read
 * back after a restart, possibly by a newer build. Every read parses it here
 * against its schema, so a wrong shape fails at once naming its key instead
 * of surfacing later as a wrong value. Writes go through `toJson`.
 */
import { copyJson, type Context, type JsonValue } from "@earendil-works/chord";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import { z } from "zod";

/** `value` as JSON to store, without its undefined fields. */
export const toJson = (value: unknown): JsonValue =>
  copyJson(value, { omitUndefinedProperties: true });

/** A stored value parsed against its schema; throws naming `key` when it does not fit. */
export function parseStored<T>(key: string, value: unknown, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Stored "${key}" does not fit its shape: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/** One task memo: its key and shape, read and kept only through here. */
export function durableMemo<T>(key: string, schema: z.ZodType<T>) {
  return {
    async read(api: Pick<ToolExecutionApi, "memo">, context: Context): Promise<T | undefined> {
      const stored = await api.memo(key, context);
      return stored === undefined ? undefined : parseStored(key, stored, schema);
    },
    /** Keep `value` unless the call already kept one; returns the kept value. */
    async keep(api: Pick<ToolExecutionApi, "memo">, value: T, context: Context): Promise<T> {
      return parseStored(key, await api.memo(key, toJson(value), context), schema);
    },
  };
}
