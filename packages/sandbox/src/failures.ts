const CLOSED =
  /has been closed|Target closed|Session closed|Connection closed|Browser closed|Not connected|Channel closed|ERR_STREAM_DESTROYED|ECONNRESET|EPIPE/i;

function messageOf(error: unknown): string {
  if (error instanceof AggregateError) return error.errors.map(messageOf).join("; ");
  return error instanceof Error ? error.message : String(error);
}

function isTimeout(error: unknown): boolean {
  if (error instanceof AggregateError) return error.errors.every(isTimeout);
  return error instanceof Error && error.name === "TimeoutError";
}

function isAlreadyClosed(error: unknown): boolean {
  return CLOSED.test(messageOf(error));
}

export function reportFailure(what: string, error: unknown): void {
  console.warn(`[sandbox] ${what}: ${messageOf(error).slice(0, 600)}`);
}

export const survived =
  (what: string) =>
  (error: unknown): undefined => {
    reportFailure(`${what} failed, carrying on`, error);
    return undefined;
  };

export const alreadyClosed =
  (what: string) =>
  (error: unknown): undefined => {
    if (!isAlreadyClosed(error)) reportFailure(`${what} failed, carrying on`, error);
    return undefined;
  };

export function waitTimedOut(error: unknown): undefined {
  if (!isTimeout(error) && !isAlreadyClosed(error)) {
    reportFailure("a browser wait ended early, carrying on", error);
  }
  return undefined;
}

export async function metInTime(wait: Promise<unknown>): Promise<boolean> {
  try {
    await wait;
    return true;
  } catch (error) {
    if (isTimeout(error)) return false;
    throw error;
  }
}

export const callerSeesRejection = (forget?: () => void) => (): undefined => {
  forget?.();
  return undefined;
};
