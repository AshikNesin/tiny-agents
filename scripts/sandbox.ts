#!/usr/bin/env tsx
/**
 * The local sandbox (docs/guides/local-sandbox.md): a Docker container that
 * stands in for the Tailscale sandbox VM, for machines that can't join the
 * tailnet.
 *
 *   pnpm sandbox:up      create the SSH key if needed, build and start the
 *                        container, wait for SSH and print the .env lines
 *   pnpm sandbox:down    stop it (files, profiles and the host key stay)
 *   pnpm sandbox:logs    follow sshd's log
 *   pnpm sandbox:shell   a shell as exedev inside the container
 *   pnpm sandbox:reset   stop it and delete the bots' home volume
 *
 * The key pair lives in data/sandbox/ (gitignored); the container trusts its
 * public half and the app signs in with the private half
 * (SANDBOX_SSH_KEY_FILE). Set SANDBOX_LOCAL_PORT to publish on another
 * loopback port than 2222.
 *
 * docker/sandbox/compose.override.yml (gitignored; copy
 * compose.override.example.yml) is merged in when present, for mounting
 * files or folders from this machine into the container.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ssh2 from "ssh2";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const compose = path.join(root, "docker/sandbox/compose.yml");
// `-f` turns off compose's own pickup of compose.override.yml, so pass it too.
const override = path.join(root, "docker/sandbox/compose.override.yml");
const composeFiles = ["-f", compose, ...(existsSync(override) ? ["-f", override] : [])];
const keyDir = path.join(root, "data/sandbox");
const keyFile = path.join(keyDir, "id_ed25519");
const port = Number(process.env.SANDBOX_LOCAL_PORT || 2222);

function docker(args: string[], { quiet = false } = {}): number {
  const result = spawnSync("docker", ["compose", ...composeFiles, ...args], {
    stdio: quiet ? "ignore" : "inherit",
    env: { ...process.env, SANDBOX_LOCAL_PORT: String(port) },
  });
  if (result.error) {
    console.error(
      `Could not run docker (${result.error.message}). Is Docker installed and running?`,
    );
    return 1;
  }
  return result.status ?? 1;
}

/** An ed25519 key pair in OpenSSH format, created once. */
function ensureKey(): void {
  if (existsSync(keyFile) && existsSync(`${keyFile}.pub`)) return;
  mkdirSync(keyDir, { recursive: true });
  const pair = ssh2.utils.generateKeyPairSync("ed25519", { comment: "tiny-agents-local-sandbox" });
  writeFileSync(keyFile, pair.private, { mode: 0o600 });
  chmodSync(keyFile, 0o600);
  writeFileSync(`${keyFile}.pub`, `${pair.public}\n`, { mode: 0o644 });
  console.log(`Created the sandbox SSH key: ${path.relative(root, keyFile)}`);
}

/** Dial the container the way the app will and run one probe command. */
function probe(): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = new ssh2.Client();
    client
      .on("ready", () => {
        client.exec(
          'echo "$(whoami) on $(. /etc/os-release && echo $PRETTY_NAME)"; tmux -V; google-chrome-stable --version; for t in gh codex; do if command -v $t >/dev/null; then $t --version | head -n 1; else echo "$t: installing (see ~/.tiny-agents/install-clis.log)"; fi; done; sudo -n true && echo \'sudo ok\'',
          (error, channel) => {
            if (error) return reject(error);
            let out = "";
            channel.on("data", (chunk: Buffer) => (out += chunk));
            channel.stderr.on("data", (chunk: Buffer) => (out += chunk));
            channel.on("close", () => {
              client.end();
              resolve(out.trim());
            });
          },
        );
      })
      .on("error", reject)
      .connect({
        host: "127.0.0.1",
        port,
        username: "exedev",
        privateKey: readFileSync(keyFile),
        readyTimeout: 5_000,
      });
  });
}

async function waitForSsh(): Promise<string> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      return await probe();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
}

async function up(): Promise<number> {
  ensureKey();
  const status = docker(["up", "-d", "--build"]);
  if (status !== 0) return status;
  console.log("\nWaiting for the sandbox's SSH…");
  try {
    console.log((await waitForSsh()).replace(/^/gm, "  "));
  } catch (error) {
    console.error(
      `The container started but SSH on 127.0.0.1:${port} didn't answer: ${(error as Error).message}\n` +
        "See `pnpm sandbox:logs`.",
    );
    return 1;
  }
  const envFile = path.join(root, ".env");
  const env = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  const configured =
    /^SANDBOX_HOST=["']?127\.0\.0\.1/m.test(env) && /^SANDBOX_SSH_KEY_FILE=\S/m.test(env);
  console.log(
    `\nThe local sandbox is up on 127.0.0.1:${port}.` +
      (configured
        ? " .env already points the app at it; restart `pnpm dev` if it was running."
        : "\nPoint the app at it in .env, then restart `pnpm dev`:\n\n" +
          `  SANDBOX_HOST=127.0.0.1\n  SANDBOX_PORT=${port}\n  SANDBOX_USER=exedev\n` +
          `  SANDBOX_SSH_KEY_FILE=${path.relative(root, keyFile)}\n`) +
      "\nClaude Code is preinstalled. To let bots answer on your Claude plan, set\n" +
      "CLAUDE_CODE_ENGINE_ENABLED=1 and sign in from Settings → Claude plan.\n" +
      (process.env.SANDBOX_SHELLEY === "0"
        ? ""
        : `\nShelley runs at http://127.0.0.1:${process.env.SANDBOX_SHELLEY_PORT || 9000} (add a model provider there,\n` +
          "or set SHELLEY_ANTHROPIC_API_KEY before `pnpm sandbox:up`)."),
  );
  return 0;
}

const commands: Record<string, () => number | Promise<number>> = {
  up,
  down: () => docker(["down"]),
  logs: () => docker(["logs", "-f", "sandbox"]),
  shell: () => docker(["exec", "-u", "exedev", "-w", "/home/exedev", "sandbox", "bash", "-l"]),
  reset: () => {
    const status = docker(["down"]);
    if (status !== 0) return status;
    // Only the bots' home; the host-key volume stays so the app's pin holds.
    return spawnSync("docker", ["volume", "rm", "tiny-agents-sandbox_home"], { stdio: "inherit" })
      .status!;
  },
};

const name = process.argv[2] ?? "up";
const command = commands[name];
if (!command) {
  console.error(`Unknown command "${name}". Use one of: ${Object.keys(commands).join(", ")}.`);
  process.exit(1);
}
process.exit(await command());
