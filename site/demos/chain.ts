// The three "How it works" demos tell one story (set the rules, ask, approve),
// so they play in reading order: each script waits for the one before it to
// finish its payoff. A replay starts the chain over.

type Gate = { promise: Promise<void>; open: () => void };

function gate(): Gate {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => (open = resolve));
  return { promise, open };
}

let gates = new Map<string, Gate>();

function get(name: string): Gate {
  let g = gates.get(name);
  if (!g) gates.set(name, (g = gate()));
  return g;
}

/** Resolves once the named demo has played its payoff. */
export function after(name: string): Promise<void> {
  return get(name).promise;
}

/** Marks the named demo's payoff as played, releasing the next one. */
export function done(name: string): void {
  get(name).open();
}

/** Forget every finished demo, for a replay. */
export function reset(): void {
  gates = new Map();
}
