import { register } from "node:module";

register("./hooks.mjs", import.meta.url);

const { startFakeShelley } =
  await import("../../../../../tests/server/code/shelley/fake-shelley.ts");
const shelley = await startFakeShelley();
process.env.SHELLEY_URL = shelley.url;
setInterval(() => shelley.push({ heartbeat: true }), 20_000).unref();
