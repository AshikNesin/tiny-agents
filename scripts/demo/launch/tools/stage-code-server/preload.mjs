// Runs inside the `code` staging instance only (tools/stage-code.mjs passes it
// to tsx with --import). No product file is changed: two module requests are
// answered with stand-ins (hooks.mjs), and a fake Shelley is started so the
// Code list has two harnesses and labels each thread with its own.
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);

// The server tests' fake Shelley (real wire format, no threads). With it and
// Claude Code configured, the thread list shows the harness label per row.
const { startFakeShelley } =
  await import("../../../../../tests/server/code/shelley/fake-shelley.ts");
const shelley = await startFakeShelley();
process.env.SHELLEY_URL = shelley.url;
// A real Shelley heartbeats every 30 s (packages/code/src/drivers/shelley/stream.ts);
// the test fake does not, and without it the app reports "Shelley unreachable".
setInterval(() => shelley.push({ heartbeat: true }), 20_000).unref();
