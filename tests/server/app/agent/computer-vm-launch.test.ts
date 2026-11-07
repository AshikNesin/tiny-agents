/**
 * The desktop launch script (issue #108) run for real in bash, against
 * stand-ins for Xtigervnc, the session bus and XFCE, so the lock, reattach
 * and process behaviour is checked rather than the script's text. Also runs
 * the window-bound secret typing script against stand-in X tools.
 */
import { execFileSync, spawn } from "node:child_process";
import { until } from "../../fixtures/until";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { LAUNCH_LOCK_FILE } from "../../../../packages/agent/src/toolkits/browser-vm-setup";
import {
  DESKTOP_ENV_FILE,
  DESKTOP_PID_FILE,
  launchDesktopCommand,
  parseDesktopLaunch,
  teardownDesktopCommand,
  wipeDesktopCommand,
} from "../../../../packages/agent/src/toolkits/computer-vm-setup";
import {
  desktopCommand,
  typeBody,
  typeSecretBody,
  WINDOW_MISMATCH_EXIT,
  DESKTOP_GONE_EXIT,
} from "../../../../packages/agent/src/toolkits/computer-x11";

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
  // Binds the X socket the script waits for and removes it on SIGTERM.
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
  // A bus daemon that outlives dbus-launch, like the real one.
  "dbus-launch": `#!/bin/sh
sleep 600 >/dev/null 2>&1 </dev/null &
echo "DBUS_SESSION_BUS_ADDRESS='unix:path=/tmp/fake-bus,guid=1';"
echo "export DBUS_SESSION_BUS_ADDRESS;"
echo "DBUS_SESSION_BUS_PID=$!;"
`,
  "xfce4-session": `#!/bin/sh
echo "$DISPLAY $XDG_CONFIG_HOME" > "$XDG_CONFIG_HOME/../.session-env"
exec sleep 600
`,
  // A window manager answers once the session runs.
  wmctrl: `#!/bin/sh
[ "$1" = "-m" ] && exit 0
exit 0
`,
};

const SHIMS: Record<string, string> = {
  setsid: `#!/bin/sh
[ "$1" = "-f" ] && shift
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

function desktopPids(profile: string): number[] {
  try {
    return readFileSync(join(profile, DESKTOP_PID_FILE), "utf8")
      .split("\n")
      .filter(Boolean)
      .map(Number);
  } catch {
    return [];
  }
}

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function run(
  command: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  stdin?: string,
): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", command], {
      env,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    // A script that exits before reading stdin makes this write fail with EPIPE.
    child.stdin.on("error", () => {});
    child.stdin.end(stdin ?? "");
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        // already gone
      }
    }, timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timer);
      setTimeout(() => resolve({ code, stdout, stderr, timedOut }), 50);
    });
  });
}

runIfPython("desktop launch script", () => {
  let tools: string;
  let root: string;
  let home: string;
  let x11: string;
  let env: NodeJS.ProcessEnv;
  let profiles: string[];

  beforeAll(() => {
    tools = mkdtempSync(join(tmpdir(), "ta-desk-tools-"));
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
    root = mkdtempSync(join(tmpdir(), "ta-desk-launch-"));
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
  });

  afterEach(() => {
    for (const profile of profiles) {
      for (const pid of desktopPids(profile)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // already gone
        }
      }
    }
    rmSync(root, { recursive: true, force: true });
  });

  const aimAtFakeX = (command: string) => {
    expect(command).toContain("/tmp/.X11-unix");
    return command
      .replaceAll("/tmp/.X11-unix", x11)
      .replaceAll("/tmp/.X$n-lock", () => `${x11}/.X$n-lock`);
  };

  async function launch(name: string, size = { width: 1280, height: 800 }) {
    const profile = join(root, "profiles", name);
    if (!profiles.includes(profile)) profiles.push(profile);
    const command = aimAtFakeX(launchDesktopCommand({ profileDir: profile, ...size }));
    return { ...(await run(command, env, 20_000)), profile };
  }

  const lockHeld = (): boolean => {
    const lockFile = join(home, ".tiny-agents", LAUNCH_LOCK_FILE);
    expect(existsSync(lockFile)).toBe(true);
    try {
      execFileSync(
        "python3",
        [
          "-c",
          "import fcntl,sys\nf=open(sys.argv[1],'a')\nfcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)",
          lockFile,
        ],
        { stdio: "pipe" },
      );
      return false;
    } catch {
      return true;
    }
  };

  it("starts a desktop, seeds XFCE and leaves the shared launch lock free", async () => {
    const a = await launch("a");
    expect(a.stderr).toBe("");
    expect(a.code).toBe(0);
    const launched = parseDesktopLaunch(a.stdout);
    expect(launched.reused).toBe(false);
    const pids = desktopPids(a.profile);
    expect(pids).toHaveLength(4); // Xtigervnc, vncconfig, the bus, the session
    expect(pids.every(alive)).toBe(true);
    expect(lockHeld()).toBe(false);
    const envFile = readFileSync(join(a.profile, DESKTOP_ENV_FILE), "utf8");
    expect(envFile).toContain(`export DISPLAY=":${launched.display}"`);
    expect(envFile).toContain("DBUS_SESSION_BUS_ADDRESS='unix:path=/tmp/fake-bus,guid=1'");
    expect(envFile).toContain(`XDG_CONFIG_HOME="${a.profile}/config"`);
    const panel = join(a.profile, "config/xfce4/xfconf/xfce-perchannel-xml/xfce4-panel.xml");
    expect(readFileSync(panel, "utf8")).toContain('channel name="xfce4-panel"');
    await until(() => existsSync(join(a.profile, ".session-env")), "the .session-env file", 5_000);
    expect(readFileSync(join(a.profile, ".session-env"), "utf8").trim()).toBe(
      `:${launched.display} ${a.profile}/config`,
    );
  }, 60_000);

  it("reattaches to a running desktop instead of starting another", async () => {
    const first = await launch("a");
    const again = await launch("a");
    expect(again.code).toBe(0);
    const before = parseDesktopLaunch(first.stdout);
    const after = parseDesktopLaunch(again.stdout);
    expect(after).toEqual({ ...before, reused: true });
    expect(desktopPids(again.profile).every(alive)).toBe(true);
  }, 60_000);

  it("replaces a desktop recorded at another size", async () => {
    const first = await launch("a");
    const stale = desktopPids(first.profile);
    const again = await launch("a", { width: 1024, height: 768 });
    expect(again.code).toBe(0);
    expect(parseDesktopLaunch(again.stdout).reused).toBe(false);
    await until(() => stale.every((pid) => !alive(pid)), "the stale stack to exit", 5_000);
    expect(stale.some(alive)).toBe(false);
    expect(desktopPids(again.profile).every(alive)).toBe(true);
  }, 60_000);

  it("relaunches when the recorded X server is gone", async () => {
    const first = await launch("a");
    const [xpid] = desktopPids(first.profile);
    process.kill(xpid, "SIGTERM");
    await until(() => !alive(xpid), "the X server to exit", 5_000);
    const again = await launch("a");
    expect(again.code).toBe(0);
    expect(parseDesktopLaunch(again.stdout).reused).toBe(false);
  }, 60_000);

  it("starts two profiles' desktops at once on distinct displays and ports", async () => {
    const [a, b] = await Promise.all([launch("a"), launch("b")]);
    expect([a.code, b.code]).toEqual([0, 0]);
    const first = parseDesktopLaunch(a.stdout);
    const second = parseDesktopLaunch(b.stdout);
    expect(first.display).not.toBe(second.display);
    expect(first.vncPort).not.toBe(second.vncPort);
  }, 60_000);

  it("tears down one desktop without touching another, and wipes a profile", async () => {
    const a = await launch("a");
    const b = await launch("b");
    const pidsA = desktopPids(a.profile);
    execFileSync("sh", ["-c", teardownDesktopCommand(a.profile)], { env });
    await until(() => pidsA.every((pid) => !alive(pid)), "profile a's stack to exit", 5_000);
    expect(pidsA.some(alive)).toBe(false);
    expect(existsSync(join(a.profile, DESKTOP_ENV_FILE))).toBe(false);
    expect(desktopPids(b.profile).every(alive)).toBe(true);

    execFileSync("sh", ["-c", wipeDesktopCommand(b.profile)], { env });
    expect(existsSync(b.profile)).toBe(false);
  }, 60_000);

  describe("tool execs", () => {
    /** Stand-in X tools for one desktop: the active window and what was typed. */
    function xTools(dir: string) {
      const bin = join(dir, "xbin");
      mkdirSync(bin, { recursive: true });
      writeFileSync(
        join(bin, "xdotool"),
        `#!/bin/sh
case "$1" in
  getactivewindow) echo 12345 ;;
  getwindowname) echo "Sign in - Mail" ;;
  type) cat > "${dir}/typed" ;;
esac
`,
        { mode: 0o755 },
      );
      writeFileSync(
        join(bin, "wmctrl"),
        `#!/bin/sh
echo "0x00003039  0 evolution.Evolution  vm Sign in - Mail"
echo "0x00004000 -1 xfce4-panel.Xfce4-panel  vm xfce4-panel"
`,
        { mode: 0o755 },
      );
      return `${bin}:${env.PATH}`;
    }

    it("types a secret only into the bound window, with nothing on the command line", async () => {
      const a = await launch("a");
      const path = xTools(root);
      const secret = "s3cret-pa55word";
      const ok = typeSecretBody({ windowClass: "Evolution", title: "sign in" });
      expect(ok).not.toContain(secret);
      const command = aimAtFakeX(desktopCommand(a.profile, ok));
      const typed = await run(command, { ...env, PATH: path }, 10_000, secret);
      expect(typed.code).toBe(0);
      expect(readFileSync(join(root, "typed"), "utf8")).toBe(secret);

      rmSync(join(root, "typed"));
      const wrong = aimAtFakeX(
        desktopCommand(a.profile, typeSecretBody({ windowClass: "firefox" })),
      );
      const refused = await run(wrong, { ...env, PATH: path }, 10_000, secret);
      expect(refused.code).toBe(WINDOW_MISMATCH_EXIT);
      expect(refused.stderr).toContain("evolution.Evolution — Sign in - Mail");
      expect(existsSync(join(root, "typed"))).toBe(false);

      const wrongTitle = aimAtFakeX(
        desktopCommand(a.profile, typeSecretBody({ windowClass: "evolution", title: "bank" })),
      );
      expect((await run(wrongTitle, { ...env, PATH: path }, 10_000, secret)).code).toBe(
        WINDOW_MISMATCH_EXIT,
      );
      expect(typeBody()).not.toMatch(/s3cret/);
    }, 60_000);

    it("reports a desktop that is not running", async () => {
      const profile = join(root, "profiles", "never");
      const command = aimAtFakeX(desktopCommand(profile, "echo hi"));
      const result = await run(command, env, 10_000);
      expect(result.code).toBe(DESKTOP_GONE_EXIT);

      const a = await launch("a");
      const [xpid] = desktopPids(a.profile);
      process.kill(xpid, "SIGTERM");
      await until(() => !alive(xpid), "the X server to exit", 5_000);
      const gone = await run(aimAtFakeX(desktopCommand(a.profile, "echo hi")), env, 10_000);
      expect(gone.code).toBe(DESKTOP_GONE_EXIT);
    }, 60_000);
  });
});
