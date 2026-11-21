import { parentPort, workerData } from "node:worker_threads";
import { extract, type ExtractInput } from "./uploads.extract";

const { input, mime } = workerData as { input: ExtractInput; mime: string };
// oxlint-disable-next-line unicorn/require-post-message-target-origin
parentPort?.postMessage(await extract(input, mime));
