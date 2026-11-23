interface RegexAtom {
  chars: Set<string> | null;
  alternatives?: RegexAtom[][];
  min?: number;
  max?: number;
}

const CLASS_ANY = /\\[dwsDWS]/;

function parseSequence(source: string, from: number): { atoms: RegexAtom[]; next: number } {
  const atoms: RegexAtom[] = [];
  let i = from;
  while (i < source.length && source[i] !== ")" && source[i] !== "|") {
    const c = source[i]!;
    if (c === "(") {
      i++;
      const inner: RegexAtom[][] = [[]];
      while (i < source.length && source[i] !== ")") {
        const parsed = parseSequence(source, i);
        inner[inner.length - 1]!.push(...parsed.atoms);
        i = parsed.next;
        if (source[i] === "|") {
          inner.push([]);
          i++;
        }
      }
      i++;
      atoms.push({ chars: null, alternatives: inner });
    } else if (c === "[") {
      const end = source.indexOf("]", i + 1);
      const body = source.slice(i + 1, end === -1 ? source.length : end);
      i = end === -1 ? source.length : end + 1;
      atoms.push({
        chars: CLASS_ANY.test(body) ? null : new Set(body.replace(/\\./g, "").split("")),
      });
    } else if (c === "\\") {
      const esc = source[i + 1] ?? "";
      i += 2;
      atoms.push({ chars: /[dwsDWS]/.test(esc) ? null : new Set([esc]) });
    } else if (c === ".") {
      i++;
      atoms.push({ chars: null });
    } else {
      i++;
      atoms.push({ chars: new Set([c]) });
    }
    const quant = quantifierAt(source, i);
    if (quant && atoms.length > 0) {
      const atom = atoms[atoms.length - 1]!;
      atom.min = quant.min;
      atom.max = quant.max;
      i = quant.next;
    }
  }
  return { atoms, next: i };
}

function quantifierAt(
  source: string,
  at: number,
): { min: number; max: number; next: number } | undefined {
  const c = source[at];
  if (c === "*" || c === "+") return { min: c === "*" ? 0 : 1, max: Infinity, next: at + 1 };
  if (c === "?") return { min: 0, max: 1, next: at + 1 };
  const brace = /^\{(\d+)(,)?(\d+)?\}/.exec(source.slice(at));
  if (brace) {
    const min = Number(brace[1]);
    const max = brace[2] ? (brace[3] ? Number(brace[3]) : Infinity) : min;
    return { min, max, next: at + brace[0].length };
  }
  return undefined;
}

function emptyable(atom: RegexAtom): boolean {
  if ((atom.min ?? 1) === 0) return true;
  if (atom.alternatives) return atom.alternatives.some((alt) => alt.every(emptyable));
  return false;
}

function firsts(atom: RegexAtom): Set<string> | null {
  if (atom.chars) return atom.chars;
  if (atom.alternatives) {
    const union = new Set<string>();
    for (const alt of atom.alternatives) {
      const set = firstsOfSequence(alt);
      if (set === null) return null;
      for (const c of set) union.add(c);
    }
    return union;
  }
  return null;
}

function firstsOfSequence(atoms: readonly RegexAtom[]): Set<string> | null {
  const union = new Set<string>();
  for (const atom of atoms) {
    const set = firsts(atom);
    if (set === null) return null;
    for (const c of set) union.add(c);
    if (!emptyable(atom)) break;
  }
  return union;
}

function overlaps(a: Set<string>, b: Set<string>): boolean {
  for (const c of a) if (b.has(c)) return true;
  return false;
}

function ambiguousGroup(alternatives: readonly RegexAtom[][]): boolean {
  if (alternatives.some((alt) => alt.every(emptyable))) return true;
  for (let i = 0; i < alternatives.length; i++) {
    for (let j = i + 1; j < alternatives.length; j++) {
      const a = firstsOfSequence(alternatives[i]!);
      const b = firstsOfSequence(alternatives[j]!);
      if (a !== null && b !== null && overlaps(a, b)) return true;
    }
  }
  return false;
}

const unbounded = (atom: RegexAtom) => (atom.max ?? 1) > 1;

function nestedUnbounded(parent: RegexAtom, child: RegexAtom): boolean {
  if (!unbounded(parent) || !unbounded(child)) return false;
  const a = firsts(parent);
  const b = firsts(child);
  return a !== null && b !== null && overlaps(a, b);
}

function ambiguous(atom: RegexAtom): boolean {
  if (atom.alternatives) {
    if (unbounded(atom) && ambiguousGroup(atom.alternatives)) return true;
    for (const alt of atom.alternatives) {
      for (const child of alt) {
        if (nestedUnbounded(atom, child)) return true;
        if (ambiguous(child)) return true;
      }
    }
  }
  return false;
}

export function ambiguousAlternation(source: string): boolean {
  const { atoms } = parseSequence(source, 0);
  return atoms.some(ambiguous);
}
