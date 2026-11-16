/**
 * When the Changes and Review panels re-read (ADR 0025).
 *
 * - `useLiveChanges`: the thread's change version, pushed by the server
 *   while a panel is open and moving only when the directory's files do;
 *   null when the directory cannot be watched (the panels then re-read on
 *   transcript activity).
 * - `useSteadyKey`: a key that follows its input at most once per period, on
 *   a fixed beat. Unlike a debounce it never waits for a pause, so a panel
 *   keeps up while an agent writes without stopping.
 */
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
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    latest.current = key;
    // One already due takes the newest key when it fires: a steady beat, not a reset.
    if (timer.current !== undefined) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      setSteady(latest.current);
    }, ms);
  }, [key, ms]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return steady;
}
