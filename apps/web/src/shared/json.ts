/**
 * What a server value becomes once it crossed the wire as JSON: a `Date`
 * field arrives as its ISO string, everything else keeps its shape. Use it
 * for a row type the server declares with `Date`s instead of copying the
 * row by hand with `string`s.
 */
export type Jsonified<T> = T extends Date
  ? string
  : T extends readonly (infer U)[]
    ? Jsonified<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonified<T[K]> }
      : T;
