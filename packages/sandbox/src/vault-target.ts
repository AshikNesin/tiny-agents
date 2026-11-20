export class VaultTargetMovedError extends Error {
  constructor(
    readonly actual: string,
    message: string,
    readonly reason = "target changed before the use",
  ) {
    super(message);
    this.name = "VaultTargetMovedError";
  }
}

const HIDDEN = "[vault]";

export class SecretValue {
  readonly #value: string;
  constructor(value: string) {
    this.#value = value;
  }
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
