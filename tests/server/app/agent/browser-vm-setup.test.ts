/**
 * Shell builders for the VM browser stack (issue #24). The install and launch
 * scripts touch apt and X, so they are only syntax-checked (`bash -n`); the
 * helpers that are safe to run for real (readiness, teardown, wipe) are.
 */
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  installStackCommand,
  launchStackCommand,
  parseLaunchOutput,
  shQuote,
  stackReadyCommand,
  teardownStackCommand,
  wipeProfileCommand,
} from "../../../../packages/agent/src/toolkits/browser-vm-setup";

/** Every builder wraps its script in `bash -c '...'`; `-n` parses without running. */
function assertValidShell(command: string) {
  expect(command.startsWith("bash -c ")).toBe(true);
  execSync(command.replace(/^bash -c /, "bash -n -c "), { stdio: "pipe" });
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("browser VM setup commands", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ta-vm-setup-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("quotes any string for the shell", () => {
    for (const value of [`plain`, `it's`, `a "b" $HOME \`x\``, `sp ace; rm -rf /`, ``]) {
      expect(execSync(`printf %s ${shQuote(value)}`, { encoding: "utf8" })).toBe(value);
    }
  });

  it("builds syntactically valid scripts", () => {
    assertValidShell(stackReadyCommand());
    assertValidShell(installStackCommand());
    assertValidShell(
      launchStackCommand({ profileDir: "/data/p", width: 1280, height: 800, scale: 2 }),
    );
    assertValidShell(teardownStackCommand("/data/p"));
  });

  it("reports whether the stack is installed", () => {
    const out = execSync(stackReadyCommand(), { encoding: "utf8" }).trim();
    expect(["ready", "missing"]).toContain(out);
  });

  it("installs under a lock, only on amd64, from the official Chrome package", () => {
    const script = installStackCommand();
    expect(script).toContain("flock 9");
    expect(script).toContain("tigervnc-standalone-server");
    expect(script).toContain("amd64");
    expect(script).toContain(
      "https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb",
    );
    // Idempotent: the marker short-circuits before any apt call.
    expect(script.indexOf("echo ready")).toBeLessThan(script.indexOf("apt-get update"));
  });

  it("launches VNC and CDP on loopback only, with no VNC password", () => {
    const script = launchStackCommand({
      profileDir: "/data/p",
      width: 1280,
      height: 800,
      scale: 2,
    });
    expect(script).toContain("-localhost");
    expect(script).toContain("-nolisten tcp");
    expect(script).toContain("-SecurityTypes None");
    expect(script).toContain("--remote-debugging-address=127.0.0.1");
    expect(script).toContain("vncconfig -nowin");
    expect(script).not.toContain("0.0.0.0");
  });

  it("sizes the display by the pixel density", () => {
    const at = (scale: number) =>
      launchStackCommand({ profileDir: "/data/p", width: 1280, height: 800, scale });
    expect(at(2)).toContain("-geometry 2560x1600");
    expect(at(2)).toContain("--force-device-scale-factor=2");
    expect(at(2)).toContain("--window-size=1280,800");
    expect(at(1)).toContain("-geometry 1280x800");
    expect(at(1)).toContain("--force-device-scale-factor=1");
    expect(at(3)).toContain("--force-device-scale-factor=1"); // only 1 or 2
  });

  it("keeps hostile profile paths inert", () => {
    const profileDir = `/data/it's a; touch ${join(dir, "pwned")} #`;
    const command = launchStackCommand({ profileDir, width: 800, height: 600, scale: 1 });
    assertValidShell(command);
    execSync(teardownStackCommand(profileDir));
    expect(existsSync(join(dir, "pwned"))).toBe(false);
  });

  it("parses the launch report and rejects anything else", () => {
    expect(parseLaunchOutput("noise\nok display=90 vnc=39449 cdp=40685\n")).toEqual({
      display: 90,
      vncPort: 39449,
      cdpPort: 40685,
    });
    expect(() => parseLaunchOutput("")).toThrow("ports");
    expect(() => parseLaunchOutput("ok display=90")).toThrow("ports");
  });

  it("tears down exactly the processes recorded at launch", async () => {
    const profile = join(dir, "profile");
    mkdirSync(profile);
    const recorded = spawn("sleep", ["60"], { stdio: "ignore", detached: true });
    const bystander = spawn("sleep", ["60"], { stdio: "ignore", detached: true });
    try {
      writeFileSync(join(profile, ".stack-pids"), `${recorded.pid}\n`);
      execSync(teardownStackCommand(profile));
      await new Promise((resolve) => recorded.once("exit", resolve));
      expect(alive(recorded.pid!)).toBe(false);
      expect(alive(bystander.pid!)).toBe(true);
      expect(existsSync(join(profile, ".stack-pids"))).toBe(false);
    } finally {
      recorded.kill();
      bystander.kill();
    }
  });

  it("tears down cleanly when nothing was launched", () => {
    expect(() => execSync(teardownStackCommand(join(dir, "never-launched")))).not.toThrow();
  });

  it("wipes the profile directory", () => {
    const profile = join(dir, "bot's profile");
    mkdirSync(profile);
    writeFileSync(join(profile, "Cookies"), "secret");
    execSync(wipeProfileCommand(profile));
    expect(existsSync(profile)).toBe(false);
  });
});
