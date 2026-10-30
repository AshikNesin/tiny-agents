import { Boom } from "./boom";
import type { HttpError } from "./http-error";

/**
 * Map SQLite constraint failures (better-sqlite3 on Node, D1 on Workers) to
 * HTTP errors. Both drivers surface the SQLite message text, e.g.
 * `UNIQUE constraint failed: users.email`, so one regex set covers both.
 */
export function toHttpError(error: unknown): HttpError | null {
  const message = error instanceof Error ? error.message : String(error);

  const unique = /UNIQUE constraint failed: \w+\.(\w+)/.exec(message);
  if (unique) return Boom.conflict(`A record with this ${unique[1]} already exists`);

  if (/FOREIGN KEY constraint failed/.test(message)) {
    return Boom.badRequest("Cannot perform this operation due to related records");
  }

  const notNull = /NOT NULL constraint failed: \w+\.(\w+)/.exec(message);
  if (notNull) return Boom.badRequest(`${notNull[1]} is required`);

  if (/CHECK constraint failed/.test(message)) return Boom.badRequest("Invalid data provided");

  return null;
}

export function isDbConstraintError(error: unknown): boolean {
  return toHttpError(error) !== null;
}
