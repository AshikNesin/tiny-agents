/**
 * The server's lifecycle: a flat list of parts, each saying how it starts
 * and how it stops. Starting runs the parts in order; stopping runs their
 * stops in reverse, so whatever a part needed is still there while it
 * stops. A failing start stops what already started and rethrows. A failing
 * stop is logged and the next stop still runs, and the whole stop has a
 * deadline, so a hung part can never keep the process alive. The first
 * signal stops; a second signal exits at once.
 */
export interface LifecyclePart {
  name: string;
  start?(): Promise<unknown> | unknown;
  stop?(): Promise<unknown> | unknown;
}

export interface LifecycleLogger {
  info(message: string): void;
  warn(context: { error?: unknown; part?: string }, message: string): void;
}

export interface LifecycleOptions {
  log: LifecycleLogger;
  /** How long every stop together may take before the process is ended anyway. */
  stopDeadlineMs?: number;
  /** Ends the process (tests pass a fake). */
  exit?: (code: number) => void;
}

export interface Lifecycle {
  /** Register a part; parts start in registration order. */
  add(part: LifecyclePart): void;
  /** Start every part in order. A failing start stops the started ones (in reverse) and rethrows. */
  start(): Promise<void>;
  /**
   * Stop every started part in reverse, each isolated. Resolves `true` when
   * all stopped in time, `false` when the deadline passed or a stop failed.
   * Calling it again returns the same outcome.
   */
  stop(reason: string): Promise<boolean>;
  /** Stop on the first of `signals` and exit; exit at once on a second one. Returns the unhook. */
  handleSignals(signals: readonly NodeJS.Signals[]): () => void;
}

export const DEFAULT_STOP_DEADLINE_MS = 10_000;

export function createLifecycle(options: LifecycleOptions): Lifecycle {
  const { log } = options;
  const deadlineMs = options.stopDeadlineMs ?? DEFAULT_STOP_DEADLINE_MS;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const parts: LifecyclePart[] = [];
  const started: LifecyclePart[] = [];
  let stopping: Promise<boolean> | undefined;
  /** The part whose stop is running now (named when the deadline passes). */
  let current: LifecyclePart | undefined;

  async function stopStarted(): Promise<boolean> {
    let clean = true;
    while (started.length > 0) {
      const part = started.pop()!;
      if (!part.stop) continue;
      current = part;
      try {
        await part.stop();
      } catch (error) {
        clean = false;
        log.warn({ error, part: part.name }, "A part failed to stop; continuing with the rest");
      }
    }
    current = undefined;
    return clean;
  }

  async function start(): Promise<void> {
    for (const part of parts) {
      try {
        await part.start?.();
      } catch (error) {
        log.warn({ error, part: part.name }, "A part failed to start; stopping what started");
        await stopStarted();
        throw error;
      }
      started.push(part);
    }
  }

  function stop(reason: string): Promise<boolean> {
    if (stopping) return stopping;
    log.info(`${reason}: shutting down`);
    stopping = new Promise<boolean>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        log.warn(
          { part: current?.name },
          `Shutdown did not finish within ${deadlineMs} ms; exiting anyway`,
        );
        resolve(false);
      }, deadlineMs);
      timer.unref?.();
      void stopStarted().then((clean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(clean);
      });
    });
    return stopping;
  }

  function handleSignals(signals: readonly NodeJS.Signals[]): () => void {
    let first = true;
    const onSignal = (signal: NodeJS.Signals) => {
      if (!first) {
        log.warn({}, `${signal} received again; exiting at once`);
        exit(130);
        return;
      }
      first = false;
      void stop(`${signal} received`).then(
        (clean) => exit(clean ? 0 : 1),
        () => exit(1),
      );
    };
    for (const signal of signals) process.on(signal, onSignal);
    return () => {
      for (const signal of signals) process.off(signal, onSignal);
    };
  }

  return {
    add(part) {
      parts.push(part);
    },
    start,
    stop,
    handleSignals,
  };
}
