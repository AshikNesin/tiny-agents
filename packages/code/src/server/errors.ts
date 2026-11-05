/**
 * Errors drivers throw. `status` follows HTTP: a harness's own 4xx answer
 * keeps its status and text; unreachable harnesses and their 5xx become 502;
 * a capability the harness lacks is 404 `capability_missing`; a harness that
 * is not configured or not ready is 503.
 */
export class HarnessError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "HarnessError";
  }
}

export function badGateway(message: string): HarnessError {
  return new HarnessError(502, message);
}

export function unavailable(message: string): HarnessError {
  return new HarnessError(503, message);
}

export function badRequest(message: string): HarnessError {
  return new HarnessError(400, message);
}

export function notFound(message: string): HarnessError {
  return new HarnessError(404, message);
}

export function capabilityMissing(what: string): HarnessError {
  return new HarnessError(404, `This harness cannot ${what}.`, "capability_missing");
}
