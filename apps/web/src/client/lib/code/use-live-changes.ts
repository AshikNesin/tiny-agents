import { useEffect, useRef, useState } from "react";
import { subscribeSse } from "../sse";
import { codeApi } from "./api";

export function useLiveChanges(
  threadId: string | null,
  cwd: string | null,
  enabled: boolean,
): number | null {
  const [version, setVersion] = useState<number | null>(null);
  useEffect(() => {
    setVersion(null);
    if (!enabled || !threadId) return;
    const connection = subscribeSse(
      codeApi.threadChangesPath(threadId, cwd),
      (raw) => {
        const event = raw as { type?: string; version?: unknown };
        if (event.type === "changes" && typeof event.version === "number") {
          setVersion(event.version);
        } else if (event.type === "unavailable") {
          setVersion(null);
        }
      },
      { onDrop: () => setVersion(null) },
    );
    return () => connection.close();
  }, [threadId, cwd, enabled]);
  return version;
}

const STEADY_MS = 750;

export function useSteadyKey<T>(key: T, ms = STEADY_MS): T {
  const [steady, setSteady] = useState(key);
  const latest = useRef(key);
  useEffect(() => {
    latest.current = key;
  }, [key]);
  const due = !Object.is(key, steady);
  useEffect(() => {
    if (!due) return;
    const timer = setTimeout(() => setSteady(latest.current), ms);
    return () => clearTimeout(timer);
  }, [due, ms]);
  return steady;
}
