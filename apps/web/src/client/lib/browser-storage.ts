function storageIsBlockedInPrivateWindows(): null {
  return null;
}

function storedJsonIsUnreadable(): null {
  return null;
}

export function readStored(key: string): string | null {
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
  } catch {
    storageIsBlockedInPrivateWindows();
  }
}

export function readStoredJson(key: string): unknown {
  const raw = readStored(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return storedJsonIsUnreadable();
  }
}
