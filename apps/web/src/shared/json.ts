export type Jsonified<T> = T extends Date
  ? string
  : T extends readonly (infer U)[]
    ? Jsonified<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonified<T[K]> }
      : T;
