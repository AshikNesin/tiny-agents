import { spawnSync } from "node:child_process";
import process from "node:process";

const run = (args) => spawnSync("pnpm", ["exec", ...args], { stdio: "inherit" }).status ?? 1;

const generated = run(["drizzle-kit", "generate", ...process.argv.slice(2)]);
process.exit(generated === 0 ? run(["vp", "fmt", "apps/web/drizzle"]) : generated);
