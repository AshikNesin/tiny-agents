/**
 * Runs extraction in a worker thread with a memory cap and a timeout
 * (issue #58 §9.3). The production build emits the worker next to the
 * bundle as `uploads-extract-worker.js` (scripts/build.mjs); dev loads the
 * TypeScript entry through tsx. Tests run in-process.
 */
import { Worker } from "node:worker_threads";
import { extract, type ExtractInput, type ExtractResult } from "./uploads.extract";

export const EXTRACT_TIMEOUT_MS = 60_000;
const WORKER_HEAP_MB = 512;

export type ExtractRunner = (input: ExtractInput, mime: string) => Promise<ExtractResult>;

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

export function runInWorker(input: ExtractInput, mime: string): Promise<ExtractResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ExtractResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(result);
    };
    const { source, eval: evaluate } = workerSource();
    const worker = new Worker(source, {
      eval: evaluate,
      workerData: { input, mime },
      resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB },
    });
    const timer = setTimeout(
      () => finish({ status: "failed", error: "Extraction timed out." }),
      EXTRACT_TIMEOUT_MS,
    );
    worker.once("message", (result: ExtractResult) => finish(result));
    worker.once("error", (error) =>
      finish({
        status: "failed",
        error:
          (error as { code?: string }).code === "ERR_WORKER_OUT_OF_MEMORY"
            ? "The file needs too much memory to read."
            : "Extraction crashed.",
      }),
    );
    worker.once("exit", (code) => {
      if (code !== 0) finish({ status: "failed", error: "Extraction stopped unexpectedly." });
    });
  });
}

/** The worker everywhere but under Vitest, which cannot load a .ts worker. */
export const defaultRunner: ExtractRunner = process.env.VITEST
  ? (input, mime) => extract(input, mime)
  : runInWorker;
