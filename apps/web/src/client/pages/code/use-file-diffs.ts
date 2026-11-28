import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReviewFileDiff } from "../../../shared/api/code";
import type { WorkspaceFile } from "./workspace-file";

const READ_AT_ONCE = 4;

let nextId = 0;
export const ids = {
  map: new WeakMap<ReviewFileDiff, number>(),
  get(d: ReviewFileDiff): number {
    let id = this.map.get(d);
    if (id === undefined) {
      id = ++nextId;
      this.map.set(d, id);
    }
    return id;
  },
};

export function useFileDiffs<F extends WorkspaceFile>(
  scopeKey: string,
  readKey: string,
  files: F[],
  isFolded: (f: F) => boolean,
  read: (path: string) => Promise<ReviewFileDiff>,
): Map<string, ReviewFileDiff> {
  const [state, setState] = useState<{
    scope: string;
    byKey: Map<string, ReviewFileDiff>;
    latest: Map<string, ReviewFileDiff>;
  }>({ scope: scopeKey, byKey: new Map(), latest: new Map() });
  const asked = useRef(new Set<string>());
  const reader = useRef(read);
  useEffect(() => {
    reader.current = read;
  }, [read]);
  const scope = useRef(scopeKey);
  useEffect(() => {
    scope.current = scopeKey;
    asked.current = new Set();
    setState({ scope: scopeKey, byKey: new Map(), latest: new Map() });
  }, [scopeKey]);
  const current = state.scope === scopeKey ? state : null;

  const keyOf = useCallback(
    (f: F) => `${scopeKey}\u0000${readKey}\u0000${f.path}\u0000${f.hash}`,
    [scopeKey, readKey],
  );
  const wanted = files.filter((f) => !isFolded(f) && !current?.byKey.has(keyOf(f)));
  const wantedKey = wanted.map(keyOf).join("\n");
  useEffect(() => {
    let cancelled = false;
    const queue = wanted.filter((f) => !asked.current.has(keyOf(f)));
    const at = scopeKey;
    const next = async () => {
      const f = queue.shift();
      if (!f || cancelled) return;
      const key = keyOf(f);
      asked.current.add(key);
      try {
        const d = await reader.current(f.path);
        setState((s) =>
          s.scope !== at || scope.current !== at
            ? s
            : {
                scope: s.scope,
                byKey: new Map(s.byKey).set(key, d),
                latest: new Map(s.latest).set(f.path, d),
              },
        );
      } catch {
        asked.current.delete(key);
      }
      await next();
    };
    for (let i = 0; i < READ_AT_ONCE; i++) void next();
    return () => {
      cancelled = true;
      for (const f of queue) asked.current.delete(keyOf(f));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKey, scopeKey, keyOf]);

  return useMemo(() => {
    const byPath = new Map<string, ReviewFileDiff>();
    if (!current) return byPath;
    for (const f of files) {
      const d = current.byKey.get(keyOf(f)) ?? current.latest.get(f.path);
      if (d) byPath.set(f.path, d);
    }
    return byPath;
  }, [files, current, keyOf]);
}
