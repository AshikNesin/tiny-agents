import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi, ToolExecutionResult } from "@earendil-works/pi-durable";
import { describe, expect, it } from "vite-plus/test";
import type { Capability } from "../../../../packages/agent/src/capabilities";
import {
  authStatusCommand,
  claudeLoginShellLine,
  ensureWorkerCommand,
  installWorkerCommand,
  stopWorkerCommand,
  uploadWorkerCommand,
} from "../../../../packages/agent/src/engines/claude-code/sandbox-setup";
import { createSandboxClaudeWorker } from "../../../../packages/agent/src/engines/claude-code/sandbox-worker";
import { createAttachmentsToolkit } from "../../../../packages/agent/src/toolkits/attachments";
import { createSandboxToolkit } from "../../../../packages/agent/src/toolkits/sandbox";
import { confinedCommand } from "../../../../packages/agent/src/toolkits/sandbox-egress";
import { createRemoteCdpTransport } from "../../../../packages/sandbox/src/browser-remote-cdp";
import {
  installStackCommand,
  LAUNCH_BUDGET_MS,
  launchStackCommand,
  parseLaunchOutput,
  stackReadyCommand,
  teardownStackCommand,
  wipeProfileCommand,
} from "../../../../packages/sandbox/src/browser-vm-setup";
import {
  DesktopGoneError,
  WindowMismatchError,
} from "../../../../packages/sandbox/src/computer-sessions";
import {
  computerStackReadyCommand,
  DESKTOP_LAUNCH_BUDGET_MS,
  installComputerStackCommand,
  launchDesktopCommand,
  parseDesktopLaunch,
  teardownDesktopCommand,
  wipeDesktopCommand,
} from "../../../../packages/sandbox/src/computer-vm-setup";
import {
  createX11ComputerTransport,
  desktopCommand,
  openAppBody,
  screenshotBody,
  typeSecretBody,
} from "../../../../packages/sandbox/src/computer-x11";
import { SandboxTimeoutError } from "../../../../packages/sandbox/src/ssh/connection";
import { parseSessionName, typeLineCommand } from "../../../../packages/sandbox/src/terminal/tmux";
import { fakeSandboxConnection, type FakeExecReply } from "./sandbox-connection-fake";

const QUOTED_DIR = "profiles/it's a; touch pwned #";
const DESKTOP_DIR = ".tiny-agents/computer-profiles/bot-1";

const SCRIPTS: Record<string, () => string> = {
  "browser-ready": () => stackReadyCommand(),
  "browser-install": () => installStackCommand(),
  "browser-launch-2x": () =>
    launchStackCommand({ profileDir: "profiles/bot-1", width: 1280, height: 800, scale: 2 }),
  "browser-launch-1x-rounded": () =>
    launchStackCommand({ profileDir: QUOTED_DIR, width: 1023.6, height: 767.4, scale: 1 }),
  "browser-launch-odd-scale": () =>
    launchStackCommand({ profileDir: "profiles/bot-1", width: 800, height: 600, scale: 1.5 }),
  "browser-teardown": () => teardownStackCommand(QUOTED_DIR),
  "browser-wipe": () => wipeProfileCommand(QUOTED_DIR),
  "computer-ready": () => computerStackReadyCommand(),
  "computer-ready-extras": () => computerStackReadyCommand(["libreoffice-calc", "gimp"]),
  "computer-install": () => installComputerStackCommand(),
  "computer-install-extras": () => installComputerStackCommand(["libreoffice-calc", "gimp"]),
  "computer-launch": () =>
    launchDesktopCommand({ profileDir: DESKTOP_DIR, width: 1280, height: 800 }),
  "computer-launch-browser-profile": () =>
    launchDesktopCommand({
      profileDir: ".tiny-agents/computer-profiles/it's",
      width: 1023.6,
      height: 767.4,
      browserProfileDir: QUOTED_DIR,
    }),
  "computer-teardown": () => teardownDesktopCommand(QUOTED_DIR),
  "computer-wipe": () => wipeDesktopCommand(QUOTED_DIR),
  "desktop-screenshot": () => desktopCommand(QUOTED_DIR, screenshotBody()),
  "desktop-open-app": () => desktopCommand(DESKTOP_DIR, openAppBody("org.gnome.Calc")),
  "desktop-type-secret": () =>
    desktopCommand(
      DESKTOP_DIR,
      typeSecretBody({ windowClass: "Firefox", title: "Log in — it's $HOME" }),
    ),
  "worker-install": () => installWorkerCommand(),
  "worker-upload": () => uploadWorkerCommand("abc'123"),
  "worker-ensure": () => ensureWorkerCommand("abc'123", 8765),
  "worker-auth-status": () => authStatusCommand(),
  "worker-stop": () => stopWorkerCommand(),
  "worker-login-line": () => claudeLoginShellLine(),
  "confined-hosts-secrets": () =>
    confinedCommand({
      command: `curl -H "x: it's" https://api.github.com`,
      allow: [{ host: "api.github.com" }, { cidr: "10.0.0.0/8" }, { host: "o'k.example" }],
      secretEnv: ["GITHUB_TOKEN", "NPM_TOKEN"],
      timeoutSecs: 12.5,
    }),
  "confined-cidr-only": () =>
    confinedCommand({ command: "npm ci", allow: [{ cidr: "10.0.0.0/8" }], timeoutSecs: 0 }),
  "tmux-type-line": () => typeLineCommand(parseSessionName("ta-term-3")!, `echo "it's $HOME"`),
};

describe("the scripts sent to the VM, byte for byte", () => {
  it.each(Object.keys(SCRIPTS))("%s", async (name) => {
    await expect(SCRIPTS[name]!()).toMatchFileSnapshot(`./__snapshots__/vm-scripts/${name}.txt`);
  });

  it("refuses an extra package that is not a package name, naming it", () => {
    expect(() => installComputerStackCommand(["gimp", "x; reboot"])).toThrow(
      new Error("Not a package name: x; reboot"),
    );
  });
});

describe("the launch reports", () => {
  it("browser: the first `ok display= vnc= cdp=` anywhere, digits only", () => {
    expect(parseLaunchOutput("noise ok display=90 vnc=1 cdp=2xyz")).toEqual({
      display: 90,
      vncPort: 1,
      cdpPort: 2,
    });
    expect(
      parseLaunchOutput("ok display=91 vnc=3 cdp=4\nok display=92 vnc=5 cdp=6 reused=1"),
    ).toEqual({ display: 91, vncPort: 3, cdpPort: 4 });
    for (const output of [
      "ok display=90 cdp=2 vnc=1",
      "ok display=90  vnc=1 cdp=2",
      "ok display=x vnc=1 cdp=2",
      "OK display=90 vnc=1 cdp=2",
      "ok display=90 vnc=1",
    ]) {
      expect(() => parseLaunchOutput(output)).toThrow(
        new Error("The VM did not report the browser stack ports"),
      );
    }
  });

  it("desktop: `reused=1` as a prefix counts, anything else does not", () => {
    expect(parseDesktopLaunch("x ok display=91 vnc=7 reused=10")).toEqual({
      display: 91,
      vncPort: 7,
      reused: true,
    });
    expect(parseDesktopLaunch("ok display=91 vnc=7 reused=0").reused).toBe(false);
    expect(parseDesktopLaunch("ok display=91 vnc=7 cdp=1 reused=1").reused).toBe(false);
    expect(parseDesktopLaunch("ok display=91 vnc=7\nreused=1").reused).toBe(false);
    expect(() => parseDesktopLaunch("ok display=91")).toThrow(
      new Error("The VM did not report the desktop's display"),
    );
  });
});

function steps(connection: ReturnType<typeof fakeSandboxConnection>, names: Map<string, string>) {
  return connection.execs.map((e) => ({
    script: names.get(e.command) ?? e.command.slice(0, 40),
    ...e.options,
  }));
}

describe("the browser stack's setup sequence", () => {
  const profile = "profiles/bot-1";
  const open = { viewportWidth: 1280, viewportHeight: 800 };
  const launch = launchStackCommand({ profileDir: profile, width: 1280, height: 800, scale: 2 });
  const names = new Map([
    [stackReadyCommand(), "ready"],
    [installStackCommand(), "install"],
    [launch, "launch"],
    [teardownStackCommand(profile), "teardown"],
    [wipeProfileCommand(profile), "wipe"],
  ]);

  function vm(replies: Partial<Record<string, FakeExecReply | Error>>) {
    return fakeSandboxConnection({
      exec: (command) => {
        const reply = replies[names.get(command) ?? ""];
        if (reply instanceof Error) throw reply;
        return reply ?? {};
      },
    });
  }

  async function openWith(connection: ReturnType<typeof vm>) {
    const phases: string[] = [];
    const error = await createRemoteCdpTransport({ connection })(profile, {
      ...open,
      onPhase: (phase) => phases.push(phase),
    }).then(
      () => undefined,
      (e: Error) => e,
    );
    return { phases, error: error?.message, steps: steps(connection, names) };
  }

  it("checks, skips the install when ready, launches, and stops it when the tunnel fails", async () => {
    const result = await openWith(
      vm({ ready: { stdout: "  ready \n" }, launch: { stdout: "ok display=90 vnc=1 cdp=2\n" } }),
    );
    expect(result).toEqual({
      phases: ["starting"],
      error: "fetch failed",
      steps: [
        { script: "ready", timeoutMs: 15_000, settleOnExit: true },
        { script: "launch", timeoutMs: LAUNCH_BUDGET_MS + 20_000, settleOnExit: true },
        { script: "teardown", timeoutMs: 15_000, settleOnExit: true },
      ],
    });
    expect(LAUNCH_BUDGET_MS).toBe(80_000);
  });

  it("installs unless the check says exactly `ready`, and stops a launch it cannot read", async () => {
    const result = await openWith(
      vm({ ready: { stdout: "Ready\n" }, launch: { stdout: "ok display=90 vnc=1\n" } }),
    );
    expect(result).toEqual({
      phases: ["installing", "starting"],
      error: "The VM did not report the browser stack ports",
      steps: [
        { script: "ready", timeoutMs: 15_000, settleOnExit: true },
        { script: "install", timeoutMs: 600_000, settleOnExit: true },
        { script: "launch", timeoutMs: 100_000, settleOnExit: true },
        { script: "teardown", timeoutMs: 15_000, settleOnExit: true },
      ],
    });
  });

  it("reads a failure as the code, the step and the last 600 characters of stderr", async () => {
    const stderr = `${"x".repeat(700)}tail\n`;
    const result = await openWith(
      vm({ ready: { stdout: "missing" }, install: { exitCode: 100, stdout: "out", stderr } }),
    );
    expect(result.error).toBe(
      `VM exec failed (100): install the browser stack\n${stderr.trim().slice(-600)}`,
    );
    expect(result.steps.map((s) => s.script)).toEqual(["ready", "install"]);
  });

  it("falls back to stdout, then to nothing, for the detail", async () => {
    expect((await openWith(vm({ ready: { exitCode: 2, stdout: " only stdout \n" } }))).error).toBe(
      "VM exec failed (2): check the browser stack\nonly stdout",
    );
    const silent = await openWith(vm({ ready: { stdout: "ready" }, launch: { exitCode: 255 } }));
    expect(silent.error).toBe("VM exec failed (255): start the browser");
    expect(silent.steps.map((s) => s.script)).toEqual(["ready", "launch", "teardown"]);
  });

  it("names the step that timed out, and a failed teardown never hides the launch error", async () => {
    const result = await openWith(
      vm({
        ready: { stdout: "ready" },
        launch: new SandboxTimeoutError(100_000),
        teardown: { exitCode: 1, stderr: "kill failed" },
      }),
    );
    expect(result.error).toBe("VM exec timed out: start the browser");
    expect(result.steps.map((s) => s.script)).toEqual(["ready", "launch", "teardown"]);
  });

  it("resets a profile in 30s, reporting a failure the same way", async () => {
    const connection = vm({ wipe: { exitCode: 1, stderr: "busy\n" } });
    const transport = createRemoteCdpTransport({ connection });
    await expect(transport.wipe!(profile)).rejects.toThrow(
      new Error("VM exec failed (1): reset the profile\nbusy"),
    );
    expect(steps(connection, names)).toEqual([
      { script: "wipe", timeoutMs: 30_000, settleOnExit: true },
    ]);
  });
});

describe("the desktop stack's setup sequence", () => {
  const size = { width: 1280, height: 800 };
  const launch = launchDesktopCommand({ profileDir: DESKTOP_DIR, ...size });
  const names = new Map([
    [computerStackReadyCommand([]), "ready"],
    [installComputerStackCommand([]), "install"],
    [launch, "launch"],
    [teardownDesktopCommand(DESKTOP_DIR), "teardown"],
    [wipeDesktopCommand(DESKTOP_DIR), "wipe"],
  ]);
  const caps = { maxBytes: 12 * 1024 * 1024, settleOnExit: true };

  function vm(
    replies: Partial<Record<string, FakeExecReply | Error>>,
    tool: (command: string) => FakeExecReply = () => ({}),
  ) {
    return fakeSandboxConnection({
      exec: (command) => {
        if (command.includes("The desktop is not running")) return tool(command);
        const reply = replies[names.get(command) ?? ""];
        if (reply instanceof Error) throw reply;
        return reply ?? {};
      },
    });
  }

  async function openWith(connection: ReturnType<typeof vm>, extraPackages?: string[]) {
    const phases: string[] = [];
    const transport = createX11ComputerTransport({ connection, extraPackages });
    const desktop = await transport
      .open("bot-1", { ...size, onPhase: (phase) => phases.push(phase) })
      .catch((e: Error) => e);
    return {
      desktop,
      phases,
      error: desktop instanceof Error ? desktop.message : undefined,
      steps: () => steps(connection, names),
    };
  }

  it("checks, skips the install when ready, launches, and stops on close", async () => {
    const connection = vm({
      ready: { stdout: "ready" },
      launch: { stdout: "ok display=91 vnc=7 reused=1" },
    });
    const result = await openWith(connection);
    expect(result.phases).toEqual(["starting"]);
    expect(DESKTOP_LAUNCH_BUDGET_MS).toBe(70_000);
    await (result.desktop as Exclude<typeof result.desktop, Error>).close();
    expect(result.steps()).toEqual([
      { script: "ready", timeoutMs: 30_000, ...caps },
      { script: "launch", timeoutMs: DESKTOP_LAUNCH_BUDGET_MS + 20_000, ...caps },
      { script: "teardown", timeoutMs: 30_000, ...caps },
    ]);
  });

  it("installs in 15 minutes, and stops a launch it cannot read", async () => {
    const result = await openWith(vm({ ready: {}, launch: { stdout: "ok vnc=7" } }));
    expect(result.phases).toEqual(["installing", "starting"]);
    expect(result.error).toBe("The VM did not report the desktop's display");
    expect(result.steps()).toEqual([
      { script: "ready", timeoutMs: 30_000, ...caps },
      { script: "install", timeoutMs: 900_000, ...caps },
      { script: "launch", timeoutMs: 90_000, ...caps },
      { script: "teardown", timeoutMs: 30_000, ...caps },
    ]);
  });

  it("refuses a bad extra package after saying it installs, before running anything", async () => {
    const connection = vm({});
    const result = await openWith(connection, ["x; reboot"]);
    expect(result.phases).toEqual(["installing"]);
    expect(result.error).toBe("Not a package name: x; reboot");
    expect(connection.execs).toHaveLength(1);
  });

  it("reads a failure as the step, the code and stderr's first 4000 characters' last 600", async () => {
    const stderr = `${"a".repeat(3500)}${"b".repeat(1000)}`;
    const result = await openWith(vm({ ready: { exitCode: 3, stdout: "out", stderr } }));
    expect(result.error).toBe(
      `Could not check the desktop stack on the VM (exit 3): ${"a".repeat(100)}${"b".repeat(500)}`,
    );
    const quiet = await openWith(vm({ ready: { exitCode: 4, stdout: " out \n" } }));
    expect(quiet.error).toBe("Could not check the desktop stack on the VM (exit 4): out");
    const silent = await openWith(vm({ ready: { stdout: "ready" }, launch: { exitCode: 5 } }));
    expect(silent.error).toBe("Could not start the desktop on the VM (exit 5)");
    expect(silent.steps().map((s) => s.script)).toEqual(["ready", "launch", "teardown"]);
  });

  it("says the computer did not answer, with the step's own timeout", async () => {
    const result = await openWith(
      vm({
        ready: { stdout: "ready" },
        launch: new SandboxTimeoutError(90_000),
        teardown: new SandboxTimeoutError(30_000),
      }),
    );
    expect(result.error).toBe("The computer did not answer within 90s");
    expect(result.steps().map((s) => s.script)).toEqual(["ready", "launch", "teardown"]);
  });

  it("resets a profile in 30s, reporting a failure the same way", async () => {
    const connection = vm({ wipe: { exitCode: 1, stderr: "busy\n" } });
    await expect(createX11ComputerTransport({ connection }).wipe("bot-1")).rejects.toThrow(
      new Error("Could not reset the computer on the VM (exit 1): busy"),
    );
    expect(steps(connection, names)).toEqual([{ script: "wipe", timeoutMs: 30_000, ...caps }]);
  });

  it("reads each tool exit code: 97 gone, 96 a window mismatch, 95 no such app", async () => {
    let reply: FakeExecReply = {};
    const connection = vm(
      { ready: { stdout: "ready" }, launch: { stdout: "ok display=91 vnc=7" } },
      () => reply,
    );
    const desktop = (await openWith(connection)).desktop as Exclude<
      Awaited<ReturnType<typeof openWith>>["desktop"],
      Error
    >;
    const click = () => desktop.click(1, 2, { button: "left", count: 1, modifiers: [] });

    for (const exitCode of [0, 95, 96]) {
      reply = { exitCode, stderr: "ignored" };
      await expect(click()).resolves.toBeUndefined();
    }
    reply = { exitCode: 95 };
    await expect(desktop.openApp("org.gnome.Calc")).rejects.toThrow(
      new Error('No application "org.gnome.Calc". Use computer_list_apps for the ids.'),
    );
    reply = { exitCode: 96 };
    await expect(desktop.openApp("org.gnome.Calc")).resolves.toBeUndefined();
    reply = { exitCode: 96, stderr: ` ${"w".repeat(300)} ` };
    const mismatch = await desktop
      .typeSecret("s3cret", { windowClass: "firefox" })
      .catch((e: unknown) => e);
    expect(mismatch).toBeInstanceOf(WindowMismatchError);
    expect((mismatch as WindowMismatchError).actual).toBe("w".repeat(200));
    reply = { exitCode: 95 };
    await expect(desktop.typeSecret("s3cret", { windowClass: "firefox" })).resolves.toBeUndefined();

    reply = { exitCode: 1, stderr: `${"e".repeat(500)}\n` };
    await expect(click()).rejects.toThrow(new Error(`Could not click: ${"e".repeat(400)}`));
    reply = { exitCode: 255, stdout: "stdout is never the detail" };
    await expect(click()).rejects.toThrow(new Error("Could not click"));

    let gone = 0;
    desktop.onDisconnect!(() => gone++);
    reply = { exitCode: 97 };
    await expect(click()).rejects.toBeInstanceOf(DesktopGoneError);
    expect(gone).toBe(1);
  });
});

describe("the Claude worker's setup failures", () => {
  it("reads a failure as the step and the last 800 characters, with no exit code", async () => {
    const stderr = `${"x".repeat(900)}end\n`;
    const connection = fakeSandboxConnection({ exec: () => ({ exitCode: 1, stderr }) });
    const worker = createSandboxClaudeWorker({ connection, script: async () => "body" });
    await expect(worker.resolve()).rejects.toThrow(
      new Error(`Could not start the Claude worker on the sandbox: ${stderr.trim().slice(-800)}`),
    );
    const silent = fakeSandboxConnection({ exec: () => ({ exitCode: 1 }) });
    await expect(
      createSandboxClaudeWorker({ connection: silent, script: async () => "body" }).resolve(),
    ).rejects.toThrow(new Error("Could not start the Claude worker on the sandbox"));
    const slow = fakeSandboxConnection({
      exec: () => {
        throw new SandboxTimeoutError(45_000);
      },
    });
    await expect(
      createSandboxClaudeWorker({ connection: slow, script: async () => "body" }).resolve(),
    ).rejects.toThrow(new Error("Sandbox timed out: start the Claude worker"));
  });
});

async function runTool(capability: Capability, name: string, args: Record<string, unknown>) {
  const tool = capability.extension.tools!.find((t) => t.name === name)!;
  const api = { conversationId: 42 } as unknown as ToolExecutionApi;
  const result = (await tool.execute(
    args as never,
    api,
    BACKGROUND_CONTEXT,
  )) as ToolExecutionResult;
  return {
    isError: result.isError,
    text: (result.output ?? []).map((b) => (b.type === "text" ? b.text : "")).join(""),
  };
}

describe("the sandbox toolkit's quoting and exit codes", () => {
  it("quotes a detached command whole", async () => {
    const connection = fakeSandboxConnection({ exec: () => ({ stdout: "4242" }) });
    await runTool(createSandboxToolkit({ connection }), "run_command", {
      command: `echo "it's" && sleep 1`,
      detached: true,
    });
    expect(connection.execs[0]!.command).toBe(
      `setsid nohup sh -c 'echo "it'\\''s" && sleep 1' > /tmp/ta-detached-$$.log 2>&1 < /dev/null & printf '%s' "$!"`,
    );
  });

  it("reads 97 as a VM that cannot confine, even for a command it did not confine", async () => {
    const connection = fakeSandboxConnection({ exec: () => ({ exitCode: 97, stderr: "why" }) });
    const result = await runTool(createSandboxToolkit({ connection }), "run_command", {
      command: "exit 97",
    });
    expect(result).toMatchObject({ isError: true });
    expect(result.text).toMatch(/^The sandbox VM can't confine commands .*:\n/);
  });

  it("reads 96 without secrets as a plain failure", async () => {
    const connection = fakeSandboxConnection({ exec: () => ({ exitCode: 96, stdout: "out" }) });
    const result = await runTool(createSandboxToolkit({ connection }), "run_command", {
      command: "exit 96",
    });
    expect(result).toEqual({ isError: true, text: "exit 96\nout" });
  });

  it("quotes the directory an attachment is copied into", async () => {
    const vm = fakeSandboxConnection();
    const capability = createAttachmentsToolkit(
      {
        list: async () => [],
        open: async () => undefined,
        original: async () => ({ name: "a.txt", bytes: new Uint8Array([1]) }),
      },
      { sandbox: vm },
    );
    await runTool(capability, "copy_attachment_to_sandbox", {
      uploadId: "u-1",
      dest: "~/it's here/a.txt",
    });
    expect(vm.execs.map((e) => e.command)).toEqual([`mkdir -p 'it'\\''s here'`]);
  });
});
