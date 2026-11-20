import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export class StoreLockedError extends Error {
  constructor(path: string) {
    super(
      `Another process owns the agent store (${path}). Only one tiny-agents server may run per data directory.`,
    );
    this.name = "StoreLockedError";
  }
}

export interface StoreLock {
  readonly path: string;
  release(): void;
}

export interface AcquireLockOptions {
  waitMs?: number;
}

export function acquireStoreLock(storePath: string, options: AcquireLockOptions = {}): StoreLock {
  const path = `${storePath}.lock`;
  if (storePath !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.floor(options.waitMs ?? 10_000))}`);
    db.exec("PRAGMA locking_mode = EXCLUSIVE");
    db.exec("CREATE TABLE IF NOT EXISTS owner (pid INTEGER, since TEXT)");
    db.exec("BEGIN EXCLUSIVE");
    db.prepare("DELETE FROM owner").run();
    db.prepare("INSERT INTO owner (pid, since) VALUES (?, ?)").run(
      process.pid,
      new Date().toISOString(),
    );
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.close();
    } catch {}
    if (error instanceof Error && /locked|busy/i.test(error.message)) {
      throw new StoreLockedError(storePath);
    }
    throw error;
  }

  let released = false;
  return {
    path,
    release() {
      if (released) return;
      released = true;
      db.close();
    },
  };
}
