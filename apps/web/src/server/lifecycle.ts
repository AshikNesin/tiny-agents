export interface LifecyclePart {
  name: string;
  needs?: readonly string[];
  start?(): Promise<unknown> | unknown;
  stop?(): Promise<unknown> | unknown;
}

interface LifecycleLogger {
  info(message: string): void;
  warn(context: { error?: unknown; part?: string }, message: string): void;
}

export interface LifecycleOptions {
  log: LifecycleLogger;
  stopDeadlineMs?: number;
  exit?: (code: number) => void;
}

export interface Lifecycle {
  add(part: LifecyclePart): void;
  start(): Promise<void>;
  stop(reason: string): Promise<boolean>;
  handleSignals(signals: readonly NodeJS.Signals[]): () => void;
}

const DEFAULT_STOP_DEADLINE_MS = 10_000;

export function createLifecycle(options: LifecycleOptions): Lifecycle {
  const { log } = options;
  const deadlineMs = options.stopDeadlineMs ?? DEFAULT_STOP_DEADLINE_MS;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const parts: LifecyclePart[] = [];
  const started: LifecyclePart[] = [];
  let stopping: Promise<boolean> | undefined;
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
        (error: unknown) => {
          log.warn({ error }, "Shutdown failed; exiting with an error");
          exit(1);
        },
      );
    };
    for (const signal of signals) process.on(signal, onSignal);
    return () => {
      for (const signal of signals) process.off(signal, onSignal);
    };
  }

  return {
    add(part) {
      for (const need of part.needs ?? []) {
        if (!parts.some((earlier) => earlier.name === need)) {
          throw new Error(`Part "${part.name}" needs "${need}", which must be added before it`);
        }
      }
      parts.push(part);
    },
    start,
    stop,
    handleSignals,
  };
}
