import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { until } from "../../fixtures/until";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  LAUNCH_LOCK_FILE,
  launchStackCommand,
  parseLaunchOutput,
  teardownStackCommand,
} from "../../../../packages/sandbox/src/browser-vm-setup";

const hasPython = (() => {
  try {
    execFileSync("python3", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
})();
const runIfPython = hasPython ? describe : describe.skip;

const FAKES: Record<string, string> = {
  Xtigervnc: `#!/usr/bin/env python3
import os, signal, socket, sys, time

path = os.path.join(os.environ["FAKE_X11_DIR"], "X" + sys.argv[1].lstrip(":"))
server = socket.socket(socket.AF_UNIX)
server.bind(path)

def stop(*_):
    os.unlink(path)
    sys.exit(0)

signal.signal(signal.SIGTERM, stop)
time.sleep(600)
`,
  vncconfig: `#!/bin/sh
exec sleep 600
`,
  "google-chrome-stable": `#!/usr/bin/env python3
import json, os, socket, sys

profile = next(a for a in sys.argv if a.startswith("--user-data-dir=")).split("=", 1)[1]
with open(os.path.join(profile, ".fake-chrome.json"), "w") as f:
    json.dump({"tz": os.environ.get("TZ"), "args": sys.argv[1:]}, f)
port = int(next(a for a in sys.argv if a.startswith("--remote-debugging-port=")).split("=")[1])
server = socket.socket()
server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server.bind(("127.0.0.1", port))
server.listen(8)
while True:
    conn, _ = server.accept()
    conn.recv(4096)
    conn.sendall(b"HTTP/1.1 200 OK\\r\\nContent-Length: 2\\r\\nConnection: close\\r\\n\\r\\n{}")
    conn.close()
`,
};

const SHIMS: Record<string, string> = {
  setsid: `#!/bin/sh
exec "$@"
`,
  flock: `#!/usr/bin/env python3
import fcntl, sys, time

args = sys.argv[1:]
wait, nonblock = None, False
while args and args[0].startswith("-"):
    flag = args.pop(0)
    if flag == "-w":
        wait = float(args.pop(0))
    elif flag == "-n":
        nonblock = True
    else:
        sys.exit(64)
fd = int(args[0])
deadline = None if wait is None else time.monotonic() + wait
while True:
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        sys.exit(0)
    except BlockingIOError:
        if nonblock or (deadline is not None and time.monotonic() >= deadline):
            sys.exit(1)
        time.sleep(0.05)
`,
};

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    return !/\) Z /.test(readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return true;
  }
}

function stackPids(profile: string): number[] {
  try {
    return readFileSync(join(profile, ".stack-pids"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map(Number);
  } catch {
    return [];
  }
}

function rawProxy(port: number, request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port });
    let reply = "";
    const timer = setTimeout(() => socket.end(), 3_000);
    socket.on("data", (chunk) => (reply += chunk.toString("latin1")));
    socket.once("error", reject);
    socket.once("close", () => {
      clearTimeout(timer);
      resolve(reply);
    });
    socket.once("connect", () => socket.write(request));
  });
}

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function run(command: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", command], {
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {}
    }, timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timer);
      setTimeout(() => resolve({ code, stdout, stderr, timedOut }), 50);
    });
  });
}

runIfPython("browser stack launch script", () => {
  let tools: string;
  let root: string;
  let home: string;
  let x11: string;
  let env: NodeJS.ProcessEnv;
  let profiles: string[];
  let holders: ChildProcess[];

  beforeAll(() => {
    tools = mkdtempSync(join(tmpdir(), "ta-vm-tools-"));
    for (const [dir, files] of [
      ["bin", FAKES],
      ["shims", SHIMS],
    ] as const) {
      mkdirSync(join(tools, dir));
      for (const [name, body] of Object.entries(files)) {
        writeFileSync(join(tools, dir, name), body, { mode: 0o755 });
      }
    }
  });

  afterAll(() => rmSync(tools, { recursive: true, force: true }));

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ta-vm-launch-"));
    home = join(root, "home");
    x11 = join(root, "x11");
    for (const dir of [join(home, ".tiny-agents"), x11]) mkdirSync(dir, { recursive: true });
    env = {
      ...process.env,
      HOME: home,
      FAKE_X11_DIR: x11,
      PATH: `${join(tools, "bin")}:${process.env.PATH}:${join(tools, "shims")}`,
    };
    profiles = [];
    holders = [];
  });

  afterEach(() => {
    for (const holder of holders) holder.kill("SIGKILL");
    for (const profile of profiles) {
      for (const pid of stackPids(profile)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
    }
    rmSync(root, { recursive: true, force: true });
  });

  async function launch(
    name: string,
    options: {
      lockWaitSeconds?: number;
      locale?: string;
      timezone?: string;
      allowedPrivateHosts?: string;
    } = {},
  ) {
    const profile = join(root, "profiles", name);
    profiles.push(profile);
    const { locale, timezone, allowedPrivateHosts } = options;
    let command = launchStackCommand({
      profileDir: profile,
      width: 1280,
      height: 800,
      scale: 2,
      ...(locale ? { locale } : {}),
      ...(timezone ? { timezone } : {}),
      ...(allowedPrivateHosts ? { allowedPrivateHosts } : {}),
    });
    expect(command).toContain("/tmp/.X11-unix");
    command = command
      .replaceAll("/tmp/.X11-unix", x11)
      .replaceAll("/tmp/.X$n-lock", () => `${x11}/.X$n-lock`);
    if (options.lockWaitSeconds !== undefined) {
      expect(command).toMatch(/flock -w \d+ 8/);
      command = command.replace(/flock -w \d+ 8/, `flock -w ${options.lockWaitSeconds} 8`);
    }
    return { ...(await run(command, env, 20_000)), profile };
  }

  const lockFile = () => join(home, ".tiny-agents", LAUNCH_LOCK_FILE);

  function lockHeld(): boolean {
    expect(existsSync(lockFile())).toBe(true);
    try {
      execFileSync(
        "python3",
        [
          "-c",
          "import fcntl,sys\nf=open(sys.argv[1],'a')\nfcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)",
          lockFile(),
        ],
        { stdio: "pipe" },
      );
      return false;
    } catch {
      return true;
    }
  }

  function holdLock(): Promise<void> {
    const holder = spawn(
      "python3",
      [
        "-c",
        "import fcntl,sys,time\nf=open(sys.argv[1],'a')\nfcntl.flock(f,fcntl.LOCK_EX)\nprint('locked',flush=True)\ntime.sleep(600)",
        lockFile(),
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    holders.push(holder);
    return new Promise((resolve, reject) => {
      holder.stdout!.once("data", () => resolve());
      holder.once("exit", () => reject(new Error("the lock holder exited early")));
    });
  }

  it("leaves the launch lock free while the browser keeps running", async () => {
    const a = await launch("a");
    expect(a.code).toBe(0);
    parseLaunchOutput(a.stdout);
    const pids = stackPids(a.profile);
    expect(pids).toHaveLength(4);
    expect(pids.every(alive)).toBe(true);
    expect(lockHeld()).toBe(false);
  }, 60_000);

  it("starts Chrome in the owner's time zone and language, as a site reads them", async () => {
    const a = await launch("a", { locale: "en-IN", timezone: "Asia/Kolkata" });
    expect(a.code).toBe(0);
    const chrome = JSON.parse(readFileSync(join(a.profile, ".fake-chrome.json"), "utf8")) as {
      tz: string | null;
      args: string[];
    };
    expect(chrome.tz).toBe("Asia/Kolkata");
    expect(chrome.args).toContain("--lang=en-IN");
    expect(chrome.args).toContain("--accept-lang=en-IN,en");
  }, 60_000);

  it("sends all of Chrome's traffic through a proxy that refuses private addresses", async () => {
    const hits: string[] = [];
    const target: Server = createServer((req, res) => {
      hits.push(req.url ?? "");
      res.end("inside");
    });
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    const port = (target.address() as AddressInfo).port;
    try {
      const strict = await launch("strict");
      const open = await launch("open", { allowedPrivateHosts: "localhost" });
      expect([strict.code, open.code]).toEqual([0, 0]);
      const proxyOf = (profile: string) => {
        const { args } = JSON.parse(readFileSync(join(profile, ".fake-chrome.json"), "utf8")) as {
          args: string[];
        };
        expect(args).toContain("--proxy-bypass-list=<-loopback>");
        const flag = args.find((arg) => arg.startsWith("--proxy-server=http://127.0.0.1:"));
        return Number(flag?.split(":").pop());
      };
      const get = (path: string) =>
        `GET http://localhost:${port}${path} HTTP/1.1\r\nHost: localhost:${port}\r\n\r\n`;

      const byName = await rawProxy(proxyOf(strict.profile), get("/by-name"));
      expect(byName).toMatch(/^HTTP\/1\.1 403 Forbidden\r\nx-tiny-agents-refused: private-address/);
      const tunnel = await rawProxy(
        proxyOf(strict.profile),
        `CONNECT [::ffff:127.0.0.1]:${port} HTTP/1.1\r\n\r\n`,
      );
      expect(tunnel).toMatch(/^HTTP\/1\.1 403 Forbidden\r\n/);
      expect(hits).toEqual([]);

      const exempt = await rawProxy(proxyOf(open.profile), get("/exempt"));
      expect(exempt).toMatch(/^HTTP\/1\.1 200 OK\r\n/);
      expect(exempt).toMatch(/inside$/);
      expect(hits).toEqual(["/exempt"]);
    } finally {
      await new Promise((resolve) => {
        target.close(resolve);
        target.closeAllConnections();
      });
    }
  }, 60_000);

  it("starts a second bot's browser while the first is still running", async () => {
    const a = await launch("a");
    const b = await launch("b");
    expect(b.timedOut).toBe(false);
    expect([a.code, b.code]).toEqual([0, 0]);
    const first = parseLaunchOutput(a.stdout);
    const second = parseLaunchOutput(b.stdout);
    expect(second.display).not.toBe(first.display);
    expect(second.cdpPort).not.toBe(first.cdpPort);
    expect(stackPids(a.profile).every(alive)).toBe(true);
    expect(stackPids(b.profile).every(alive)).toBe(true);
  }, 60_000);

  it("serializes simultaneous launches onto distinct displays and ports", async () => {
    const [a, b] = await Promise.all([launch("a"), launch("b")]);
    expect([a.code, b.code]).toEqual([0, 0]);
    const first = parseLaunchOutput(a.stdout);
    const second = parseLaunchOutput(b.stdout);
    expect(new Set([first.display, second.display]).size).toBe(2);
    expect(new Set([first.vncPort, first.cdpPort, second.vncPort, second.cdpPort]).size).toBe(4);
  }, 60_000);

  it("replaces a stale stack of the same profile instead of waiting on it", async () => {
    const first = await launch("a");
    const stale = stackPids(first.profile);
    const again = await launch("a");
    expect(again.timedOut).toBe(false);
    expect(again.code).toBe(0);
    await until(() => stale.every((pid) => !alive(pid)), "the stale stack to exit", 5_000);
    expect(stale.some(alive)).toBe(false);
    expect(stackPids(again.profile).every(alive)).toBe(true);
  }, 60_000);

  it("closes the computer's Chrome on the same profile before starting", async () => {
    const profile = join(root, "profiles", "shared");
    mkdirSync(profile, { recursive: true });
    const desktopChrome = spawn(
      "python3",
      ["-c", "import time; time.sleep(600)", `--user-data-dir=${profile}`, "about:blank"],
      { stdio: "ignore" },
    );
    const other = spawn(
      "python3",
      ["-c", "import time; time.sleep(600)", `--user-data-dir=${profile}-2`],
      { stdio: "ignore" },
    );
    try {
      await until(() => alive(desktopChrome.pid!) && alive(other.pid!), "the stand-ins", 5_000);
      const result = await launch("shared");
      expect(result.code).toBe(0);
      expect(alive(desktopChrome.pid!)).toBe(false);
      expect(alive(other.pid!)).toBe(true);
    } finally {
      desktopChrome.kill("SIGKILL");
      other.kill("SIGKILL");
    }
  }, 60_000);

  it("gives up with a clear message when another launch never finishes", async () => {
    await holdLock();
    const result = await launch("a", { lockWaitSeconds: 1 });
    expect(result.timedOut).toBe(false);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/waiting for another browser/);
    expect(existsSync(join(result.profile, ".stack-pids"))).toBe(false);
  }, 60_000);

  it("tears down one browser without touching another", async () => {
    const a = await launch("a");
    const b = await launch("b");
    expect([a.code, b.code]).toEqual([0, 0]);
    const pidsA = stackPids(a.profile);
    expect(pidsA).toHaveLength(4);
    execFileSync("sh", ["-c", teardownStackCommand(a.profile)], { env });
    await until(() => pidsA.every((pid) => !alive(pid)), "profile a's stack to exit", 5_000);
    expect(pidsA.some(alive)).toBe(false);
    expect(stackPids(b.profile)).toHaveLength(4);
    expect(stackPids(b.profile).every(alive)).toBe(true);
  }, 60_000);
});
