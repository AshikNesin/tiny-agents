import { parseJson } from "@tiny-agents/std";
import { z } from "zod";

const STORED_EVENT = "tiny-agents:stored";
const refused = new Map<string, string | null>();

function storageIsBlockedInPrivateWindows(): null {
  return null;
}

function keepForThisPageBecauseStorageRefusedIt(key: string, value: string | null): void {
  refused.set(key, value);
}

function storedJsonIsUnreadable(): null {
  return null;
}

export function readStored(key: string): string | null {
  const kept = refused.get(key);
  if (kept !== undefined) return kept;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return storageIsBlockedInPrivateWindows();
  }
}

export function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    refused.delete(key);
  } catch {
    keepForThisPageBecauseStorageRefusedIt(key, value);
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(STORED_EVENT));
}

export function subscribeStored(listener: () => void): () => void {
  window.addEventListener(STORED_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(STORED_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export function readStoredJson(key: string): unknown {
  const raw = readStored(key);
  if (raw === null) return null;
  try {
    return parseJson("A stored browser value", raw, z.unknown());
  } catch {
    return storedJsonIsUnreadable();
  }
}
