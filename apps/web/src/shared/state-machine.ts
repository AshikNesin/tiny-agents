export interface StateMachine<S extends string> {
  readonly name: string;
  readonly states: readonly [S, ...S[]];
  readonly initial: readonly S[];
  readonly transitions: Readonly<Record<S, readonly S[]>>;
  readonly terminal: readonly S[];
  is(value: unknown): value is S;
  can(from: S, to: S): boolean;
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
