/**
 * SQLite constraint checks for app code (the replacement for Prisma's P2002).
 * Drizzle may wrap the driver error, so the cause chain is searched too.
 */
function messages(error: unknown): string[] {
  const out: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    if (current instanceof Error) {
      out.push(current.message);
      current = current.cause;
    } else {
      out.push(String(current));
      break;
    }
  }
  return out;
}

/** True for a UNIQUE (or primary key) constraint failure, optionally on one `table.column`. */
export function isUniqueViolation(error: unknown, column?: string): boolean {
  return messages(error).some(
    (message) =>
      /(UNIQUE|PRIMARY KEY) constraint failed/.test(message) &&
      (column === undefined || message.includes(column)),
  );
}
