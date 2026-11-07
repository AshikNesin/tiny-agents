/**
 * A task memo or document field is read back after a restart, possibly by a
 * newer build than the one that stored it, so every read parses it.
 */
import { copyJson, type Context, type JsonValue } from "@earendil-works/chord";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import { z } from "zod";

export const toJson = (value: unknown): JsonValue =>
  copyJson(value, { omitUndefinedProperties: true });

export function parseStored<T>(key: string, value: unknown, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Stored "${key}" does not fit its shape: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export function durableMemo<T>(key: string, schema: z.ZodType<T>) {
  return {
    async read(api: Pick<ToolExecutionApi, "memo">, context: Context): Promise<T | undefined> {
      const stored = await api.memo(key, context);
      return stored === undefined ? undefined : parseStored(key, stored, schema);
    },
    /** Keeps `value` unless the call already kept one; returns the kept value. */
    async keep(api: Pick<ToolExecutionApi, "memo">, value: T, context: Context): Promise<T> {
      return parseStored(key, await api.memo(key, toJson(value), context), schema);
    },
  };
}
