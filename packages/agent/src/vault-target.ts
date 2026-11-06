/**
 * The vault's one "target moved" error (issue #56), apart from the port so
 * the browser and computer subpaths, which never load pi-durable, can throw
 * it.
 */

/**
 * A sink's target moved after the use was allowed: the page navigated off
 * the origin, another window came to the front. The sink throws it before
 * any value leaves; the broker audits it as `refused_origin` with `reason`,
 * and `useFromSink` words it for the model. Sinks throw a subclass that
 * says what moved (`OriginMismatchError`, `WindowMismatchError`).
 */
export class VaultTargetMovedError extends Error {
  constructor(
    /** Where the target is now: the page's origin, the window in front. */
    readonly actual: string,
    message: string,
    /** The audit row's reason. */
    readonly reason = "target changed before the use",
  ) {
    super(message);
    this.name = "VaultTargetMovedError";
  }
}
