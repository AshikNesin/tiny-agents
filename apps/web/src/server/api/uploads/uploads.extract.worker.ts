import { parentPort, workerData } from "node:worker_threads";
import { extract, type ExtractInput } from "./uploads.extract";

const { input, mime } = workerData as { input: ExtractInput; mime: string };
parentPort?.postMessage(await extract(input, mime));
