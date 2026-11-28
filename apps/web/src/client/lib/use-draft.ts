import { useMemo, useSyncExternalStore } from "react";
import { parseJson } from "@tiny-agents/std";
import type { z } from "zod";
import { useUiStore } from "../store/ui";
import { readStored, subscribeStored, writeStored } from "./browser-storage";

export interface Draft<T> {
  value: T;
  update: (change: (current: T) => T) => void;
  clear: () => void;
  submitting: boolean;
  submit: (send: (value: T) => Promise<unknown>) => Promise<"sent" | "busy">;
}

function storedDraftNoLongerFits<T>(empty: T): T {
  return empty;
}

function parseDraft<T>(raw: string | null, schema: z.ZodType<T>, empty: T): T {
  if (raw === null) return empty;
  try {
    return parseJson("A stored draft", raw, schema);
  } catch {
    return storedDraftNoLongerFits(empty);
  }
}

export function useDraft<T>(key: string, schema: z.ZodType<T>, empty: T): Draft<T> {
  const raw = useSyncExternalStore(subscribeStored, () => readStored(key));
  const value = useMemo(() => parseDraft(raw, schema, empty), [raw, schema, empty]);
  const submitting = useUiStore((s) => s.draftsSending.includes(key));
  const current = () => parseDraft(readStored(key), schema, empty);
  const clear = () => writeStored(key, null);
  return {
    value,
    update: (change) => {
      const next = JSON.stringify(change(current()));
      writeStored(key, next === JSON.stringify(empty) ? null : next);
    },
    clear,
    submitting,
    submit: async (send) => {
      if (useUiStore.getState().draftsSending.includes(key)) return "busy";
      useUiStore.getState().setDraftSending(key, true);
      try {
        await send(current());
        clear();
        return "sent";
      } finally {
        useUiStore.getState().setDraftSending(key, false);
      }
    },
  };
}
