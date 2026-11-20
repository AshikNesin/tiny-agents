import { spawnSync } from "node:child_process";

const RELATIVE = ".vite-hooks/_";

const current = spawnSync("git", ["config", "--local", "--get", "core.hooksPath"], {
  encoding: "utf8",
});
const value = current.status === 0 ? current.stdout.trim() : "";
if (value.startsWith("/") && value.endsWith(`/${RELATIVE}`)) {
  spawnSync("git", ["config", "--local", "core.hooksPath", RELATIVE], { stdio: "inherit" });
  console.log(`core.hooksPath: ${value} -> ${RELATIVE}`);
}
