/**
 * One shape for every lifecycle a row (or a view) moves through: its
 * states, the states a row may start in, and the moves allowed from each
 * state. A machine is data, free of database, HTTP and React imports, so the
 * server's writes, the client's types and the docs all read the same graph.
 *
 * Writes use `sourcesOf(to)` as their compare-and-set guard
 * (`WHERE status IN (…)`), so a racing writer or a stale event can never
 * move a row along an edge the graph does not have. Every machine is listed
 * in docs/reference/state-machines.md.
 */
export interface StateMachine<S extends string> {
  /** For error messages and the docs. */
  readonly name: string;
  /** Every state, in display order. */
  readonly states: readonly [S, ...S[]];
  /** The states a new row may be created in. */
  readonly initial: readonly S[];
  /** The states each state may move to. */
  readonly transitions: Readonly<Record<S, readonly S[]>>;
  /** States with no way out. */
  readonly terminal: readonly S[];
  /** Narrow a stored string (a row read back from the database). */
  is(value: unknown): value is S;
  can(from: S, to: S): boolean;
  /** The states `to` may be entered from: the compare-and-set guard of a write. */
  sourcesOf(to: S): S[];
}

export function defineMachine<const S extends string>(spec: {
  name: string;
  states: readonly [S, ...S[]];
  initial: readonly S[];
  transitions: Readonly<Record<S, readonly S[]>>;
}): StateMachine<S> {
  const known = new Set<string>(spec.states);
  const can = (from: S, to: S) => spec.transitions[from].includes(to);
  return {
    ...spec,
    terminal: spec.states.filter((state) => spec.transitions[state].length === 0),
    is: (value): value is S => typeof value === "string" && known.has(value),
    can,
    sourcesOf: (to) => spec.states.filter((from) => can(from, to)),
  };
}
