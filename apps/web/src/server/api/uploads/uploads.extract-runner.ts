/**
 * Runs extraction in a worker thread with a memory cap and a timeout
 * (issue #58 §9.3). The production build emits the worker next to the
 * bundle as `uploads-extract-worker.js` (scripts/build.mjs); dev loads the
 * TypeScript entry through tsx. The worker itself sits behind `spawn`, so
 * the timeout, crash and exit handling is testable without a thread.
 */
import { Worker } from "node:worker_threads";
import { extract, type ExtractInput, type ExtractResult } from "./uploads.extract";
import { appEnv } from "../../env";

export const EXTRACT_TIMEOUT_MS = 60_000;
const WORKER_HEAP_MB = 512;

export type ExtractRunner = (input: ExtractInput, mime: string) => Promise<ExtractResult>;

/** What the runner needs from a worker thread (a `Worker`, or a fake in tests). */
export interface WorkerLike {
  once(event: "message", listener: (result: ExtractResult) => void): unknown;
  once(event: "error", listener: (error: Error & { code?: string }) => void): unknown;
  once(event: "exit", listener: (code: number) => void): unknown;
  terminate(): unknown;
}

/**
 * The built worker next to the bundle, or in dev a bootstrap that registers
 * tsx inside the worker (loader hooks don't carry over into threads) and
 * imports the TypeScript entry.
 */
function workerSource(): { source: URL | string; eval: boolean } {
  const here = import.meta.url;
  if (!here.endsWith(".ts")) {
    return { source: new URL("./uploads-extract-worker.js", here), eval: false };
  }
  const entry = new URL("./uploads.extract.worker.ts", here).href;
  const tsx = import.meta.resolve("tsx/esm/api");
  return {
    source: `import(${JSON.stringify(tsx)}).then((api) => { api.register(); return import(${JSON.stringify(entry)}); });`,
    eval: true,
  };
}

function spawnWorker(input: ExtractInput, mime: string): WorkerLike {
  const { source, eval: evaluate } = workerSource();
  return new Worker(source, {
    eval: evaluate,
    workerData: { input, mime },
    resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB },
  });
}

/**
 * A runner over `spawn`: the first of the worker's result, an error, a
 * non-zero exit or the timeout decides, and the worker is terminated.
 */
export function createWorkerRunner(
  options: {
    spawn?: (input: ExtractInput, mime: string) => WorkerLike;
    timeoutMs?: number;
  } = {},
): ExtractRunner {
  const spawn = options.spawn ?? spawnWorker;
  const timeoutMs = options.timeoutMs ?? EXTRACT_TIMEOUT_MS;
  return (input, mime) =>
    new Promise((resolve) => {
      let settled = false;
      const worker = spawn(input, mime);
      const finish = (result: ExtractResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        resolve(result);
      };
      const timer = setTimeout(
        () => finish({ status: "failed", error: "Extraction timed out." }),
        timeoutMs,
      );
      worker.once("message", (result) => finish(result));
      worker.once("error", (error) =>
        finish({
          status: "failed",
          error:
            error.code === "ERR_WORKER_OUT_OF_MEMORY"
              ? "The file needs too much memory to read."
              : "Extraction crashed.",
        }),
      );
      worker.once("exit", (code) => {
        if (code !== 0) finish({ status: "failed", error: "Extraction stopped unexpectedly." });
      });
    });
}

export const runInWorker: ExtractRunner = createWorkerRunner();

/** The worker everywhere but under Vitest, which cannot load a .ts worker. */
export const defaultRunner: ExtractRunner = (input, mime) =>
  appEnv().VITEST ? extract(input, mime) : runInWorker(input, mime);
