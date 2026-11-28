const MISSING_CODES: ReadonlySet<string> = new Set(["ENOENT", "ENOTDIR"]);

function isMissingPath(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    MISSING_CODES.has(error.code)
  );
}

export function missingAs<T>(value: T): (error: unknown) => T {
  return (error) => {
    if (isMissingPath(error)) return value;
    throw error;
  };
}

export function warnFailure(what: string, error: unknown): void {
  console.warn(`claude-worker: ${what}: ${error instanceof Error ? error.message : String(error)}`);
}

export function warnedAs<T>(what: string, value: T): (error: unknown) => T {
  return (error) => {
    warnFailure(what, error);
    return value;
  };
}
