/**
 * Worker-thread entry for extraction (issue #58 §9.3): a parser that crashes,
 * hangs or balloons takes down this worker, never the web process. The
 * runner (`uploads.extract-runner.ts`) bounds its memory and time.
 */
import { parentPort, workerData } from "node:worker_threads";
import { extract, type ExtractInput } from "./uploads.extract";

const { input, mime } = workerData as { input: ExtractInput; mime: string };
parentPort?.postMessage(await extract(input, mime));
