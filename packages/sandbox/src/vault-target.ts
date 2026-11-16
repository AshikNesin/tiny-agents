/**
 * The vault's pi-durable-free pieces (issue #56), apart from the port in
 * `@tiny-agents/agent` so the browser and computer sinks here can take secret
 * values and throw the "target moved" error. The agent's vault port
 * re-exports both.
 */

/**
 * A sink's target moved after the use was allowed: the page navigated off
 * the origin, another window came to the front. The sink throws it before
 * any value leaves; the broker audits it as `refused_origin` with `reason`,
 * and `vaultUseFromSink` words it for the model. Sinks throw a subclass that
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

const HIDDEN = "[vault]";

/** A value that can't be serialized or logged by accident. */
export class SecretValue {
  readonly #value: string;
  constructor(value: string) {
    this.#value = value;
  }
  /** Only sinks call this. */
  reveal(): string {
    return this.#value;
  }
  toJSON(): string {
    return HIDDEN;
  }
  toString(): string {
    return HIDDEN;
  }
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return HIDDEN;
  }
}
