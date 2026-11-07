/**
 * The Claude worker on the sandbox: the shell scripts the app runs over SSH
 * (sandbox-setup.ts) and the locator that runs them and tunnels to the
 * worker (sandbox-worker.ts). The scripts run for real here, in bash with
 * a temporary HOME standing in for the sandbox user's, through a fake SSH
 * client; the install's network steps are skipped by pre-creating what they
 * leave behind. Nothing here installs Claude Code or calls Anthropic.
 */
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  CLAUDE_WORKER_PACKAGES,
  CLAUDE_WORKER_STACK_VERSION,
  claudeLoginShellLine,
  ensureWorkerCommand,
  installWorkerCommand,
  parseEnsureOutput,
  stopWorkerCommand,
  uploadWorkerCommand,
  workerPackageJson,
} from "../../../../packages/agent/src/engines/claude-code/sandbox-setup";
import { createSandboxClaudeWorker } from "../../../../packages/agent/src/engines/claude-code/sandbox-worker";
import { ClaudeCodeEngine } from "../../../../packages/agent/src/engines/claude-code/engine";
import {
  FORBIDDEN_BACKEND_FLAGS,
  FORBIDDEN_OVERRIDE_KEYS,
} from "../../../../packages/claude-worker/src/index";
import { fakeSandboxConnection } from "./sandbox-connection-fake";

/** A fake worker: a TCP echo server that records the env it was started with. */
const FAKE_WORKER = `
import { createServer } from "node:net";
import { writeFileSync } from "node:fs";
writeFileSync(new URL("./env.json", import.meta.url), JSON.stringify(process.env));
createServer((s) => s.pipe(s)).listen(Number(process.env.CLAUDE_WORKER_PORT), "127.0.0.1");
`;

let home: string;
let dir: string;

/** Run a command the way sshd would, as the sandbox user in `home`. */
function run(command: string, stdin?: string, env: Record<string, string> = {}) {
  return spawnSync("sh", ["-c", command], {
    input: stdin,
    encoding: "utf8",
    env: { ...process.env, HOME: home, ...env },
  });
}

/** What the install leaves, without the network: the marker and a stub CLI. */
function fakeInstall(
  authStatus = '{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"max"}',
) {
  mkdirSync(join(dir, "node_modules/.bin"), { recursive: true });
  writeFileSync(join(dir, `.stack-${CLAUDE_WORKER_STACK_VERSION}`), "");
  const cli = join(dir, "node_modules/.bin/claude");
  writeFileSync(cli, `#!/bin/sh\nprintf '%s\\n' '${authStatus}'\n`);
  chmodSync(cli, 0o755);
}

/**
 * The sandbox as an in-memory connection: exec runs locally in sh as the
 * sandbox user in `home`, and a forward dials this machine's loopback.
 */
function fakeSandbox(env: Record<string, string> = {}) {
  return fakeSandboxConnection({
    exec: (command, options) =>
      new Promise((resolve) => {
        const child = spawn("sh", ["-c", command], { env: { ...process.env, HOME: home, ...env } });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
        child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
        // The worker keeps the pipes open; settle shortly after exit, as the
        // real connection does for these commands.
        child.on("exit", (code) =>
          setTimeout(() => resolve({ stdout, stderr, exitCode: code ?? 255 }), 50),
        );
        child.stdin.on("error", () => {});
        child.stdin.end(options.stdin);
      }),
    forward: (port) =>
      new Promise((resolve, reject) => {
        const socket = connect(port, "127.0.0.1");
        socket.once("connect", () => resolve(socket));
        socket.once("error", reject);
      }),
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number };
      server.close(() => resolve(address.port));
    });
  });
}

function echo(port: number, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => socket.write(text));
    socket.once("data", (d) => {
      socket.destroy();
      resolve(d.toString());
    });
    socket.once("error", reject);
  });
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "claude-sandbox-"));
  dir = join(home, ".tiny-agents/claude-worker");
});

afterEach(() => {
  run(stopWorkerCommand());
  rmSync(home, { recursive: true, force: true });
});

describe("the sandbox worker scripts", () => {
  it("pins the packages and strips every login override before starting", () => {
    const pkg = JSON.parse(workerPackageJson()) as { dependencies: Record<string, string> };
    expect(pkg.dependencies).toEqual(CLAUDE_WORKER_PACKAGES);
    const ensure = ensureWorkerCommand("abc", 8765);
    for (const key of [...FORBIDDEN_OVERRIDE_KEYS, ...FORBIDDEN_BACKEND_FLAGS]) {
      expect(ensure).toContain(`-u ${key}`);
    }
    expect(ensure).not.toContain("ANTHROPIC_BASE_URL=");
    expect(installWorkerCommand()).toContain("npm");
  });

  it("parses the ensure answers", () => {
    expect(parseEnsureOutput("missing\n")).toEqual({ state: "missing" });
    expect(parseEnsureOutput("upload")).toEqual({ state: "upload" });
    expect(parseEnsureOutput("noise\nok abc+/=")).toEqual({ state: "ok", token: "abc+/=" });
    expect(() => parseEnsureOutput("what")).toThrow(/unexpected/);
  });

  it("asks for the install, then the upload, then starts the worker once", async () => {
    const port = await freePort();
    expect(run(ensureWorkerCommand("v1", port)).stdout.trim()).toBe("missing");
    fakeInstall();
    expect(run(ensureWorkerCommand("v1", port)).stdout.trim()).toBe("upload");

    const upload = run(uploadWorkerCommand("v1"), FAKE_WORKER);
    expect(upload.stdout.trim()).toBe("uploaded");

    const first = run(ensureWorkerCommand("v1", port), undefined, {
      ANTHROPIC_API_KEY: "sk-ant-api-should-not-pass",
      CLAUDE_CODE_USE_BEDROCK: "1",
    });
    expect(first.stderr).toBe("");
    const started = parseEnsureOutput(first.stdout);
    expect(started.state).toBe("ok");
    const token = started.state === "ok" ? started.token : "";
    expect(Buffer.from(token, "base64")).toHaveLength(32);
    expect(await echo(port, "hi")).toBe("hi");

    const env = JSON.parse(readFileSync(join(dir, "env.json"), "utf8")) as Record<string, string>;
    expect(env.CLAUDE_WORKER_TOKEN).toBe(token);
    expect(env.CLAUDE_CODE_COMMAND).toBe(join(dir, "node_modules/.bin/claude"));
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();

    const pid = readFileSync(join(dir, "worker.pid"), "utf8");
    expect(parseEnsureOutput(run(ensureWorkerCommand("v1", port)).stdout)).toEqual(started);
    expect(readFileSync(join(dir, "worker.pid"), "utf8")).toBe(pid);
    // A new app bundle asks for its own upload.
    expect(run(ensureWorkerCommand("v2", port)).stdout.trim()).toBe("upload");
  });

  it("types the sign-in into a shell, through Claude Code's own command", () => {
    expect(claudeLoginShellLine()).toMatch(/claude auth login$/);
  });
});

describe("the sandbox worker locator", () => {
  it("uploads the bundle, starts it, tunnels to it and restarts it when it dies", async () => {
    fakeInstall();
    const port = await freePort();
    const locator = createSandboxClaudeWorker({
      connection: fakeSandbox(),
      script: async () => FAKE_WORKER,
      port,
    });
    try {
      expect(locator.host).toBe("sandbox.test");
      const target = await locator.resolve();
      expect(target.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/);
      expect(Buffer.from(target.token, "base64")).toHaveLength(32);
      const local = Number(new URL(target.url).port);
      expect(await echo(local, "through the tunnel")).toBe("through the tunnel");

      // The sandbox rebooted: the next socket brings the worker back.
      run(stopWorkerCommand());
      await new Promise((r) => setTimeout(r, 300));
      expect(await echo(local, "again")).toBe("again");
      expect((await locator.resolve()).token).toBe(target.token);
    } finally {
      locator.close();
    }
  });

  it("reports the Claude login the CLI prints, never more", async () => {
    fakeInstall('{"loggedIn":false}');
    const port = await freePort();
    const locator = createSandboxClaudeWorker({
      connection: fakeSandbox(),
      script: async () => FAKE_WORKER,
      port,
    });
    try {
      await locator.resolve();
      const account = await locator.account();
      expect(account).toMatchObject({ state: "ready", loggedIn: false, subscription: false });
      fakeInstall();
      expect(await locator.account()).toEqual({
        state: "ready",
        loggedIn: true,
        subscription: true,
        plan: "max",
      });
    } finally {
      locator.close();
    }
  });
});

describe("the engine's worker choice", () => {
  const sandbox = {
    mode: "sandbox" as const,
    host: "tiny-agents-vm",
    resolve: async () => ({ url: "ws://127.0.0.1:1", token: "t" }),
    prepare: () => {},
    account: async () => ({ state: "installing" as const }),
    close: () => {},
  };

  it("uses the sandbox worker with nothing but the kill switch set", async () => {
    const engine = new ClaudeCodeEngine({
      plan: () => ({ enabled: true, fallback: "pause" }),
      worker: sandbox,
    });
    expect(engine.status()).toEqual({
      enabled: true,
      fallback: "pause",
      configured: true,
      mode: "sandbox",
      workerHost: "tiny-agents-vm",
    });
    expect(await engine.account()).toEqual({ state: "installing" });
  });

  it("is unconfigured without a sandbox", () => {
    const engine = new ClaudeCodeEngine({});
    expect(engine.status()).toMatchObject({ configured: false, mode: "none" });
  });
});
