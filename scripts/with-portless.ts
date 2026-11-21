#!/usr/bin/env tsx
import { spawn, spawnSync } from "node:child_process";

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("usage: with-portless <command> [args...]");
  process.exit(1);
}

const name = process.env.npm_package_name ?? "tiny-agents";
const disabled = process.env.PORTLESS === "0";
const installed =
  !disabled && spawnSync("portless", ["--version"], { stdio: "ignore" }).status === 0;

if (!disabled && !installed) {
  const port = process.env.PORT ?? "3000";
  console.log(`portless is not installed, so the app runs at http://localhost:${port}`);
  console.log("Install it with `npm install -g portless` for https://tiny-agents.localhost\n");
}

const child = installed
  ? spawn("portless", ["run", "--name", name, cmd, ...args], { stdio: "inherit" })
  : spawn(cmd, args, { stdio: "inherit" });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill(signal));
}
child.on("close", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
