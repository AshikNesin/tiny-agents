import type { StorageAdapter } from "./adapter";

let adapter: StorageAdapter | null = null;

export function setStorageAdapter(next: StorageAdapter): void {
  adapter = next;
}

export function getStorage(): StorageAdapter {
  if (!adapter) {
    throw new Error("Storage is not configured. Pass a `storage` adapter to bootstrap().");
  }
  return adapter;
}

export const storage: StorageAdapter = new Proxy({} as StorageAdapter, {
  get(_target, prop) {
    const target = getStorage();
    const value = Reflect.get(target, prop, target);
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(target)
      : value;
  },
});
