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

export function after(name: string): Promise<void> {
  return get(name).promise;
}

export function done(name: string): void {
  get(name).open();
}

export function reset(): void {
  gates = new Map();
}
