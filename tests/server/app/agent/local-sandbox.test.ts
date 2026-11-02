/**
 * The local sandbox image (docker/sandbox/) preinstalls what the app would
 * install on the VM on first use, and leaves the same markers, so the first
 * bot call skips apt. If the installers change and the image doesn't, the
 * app still works (it installs the difference over SSH) but slowly; these
 * checks keep the two in step.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  installStackCommand,
  STACK_VERSION,
} from "../../../../packages/agent/src/toolkits/browser-vm-setup";
import {
  COMPUTER_PACKAGES,
  COMPUTER_STACK_VERSION,
} from "../../../../packages/agent/src/toolkits/computer-vm-setup";

const dir = join(import.meta.dirname, "../../../../docker/sandbox");
const dockerfile = readFileSync(join(dir, "Dockerfile"), "utf8");
const words = new Set(dockerfile.split(/[\s\\]+/));

describe("the local sandbox image", () => {
  it("preinstalls the computer stack", () => {
    const missing = COMPUTER_PACKAGES.filter((name) => !words.has(name));
    expect(missing).toEqual([]);
  });

  it("preinstalls the browser stack's apt packages", () => {
    const install = /apt-get install -y -qq --no-install-recommends ([^\n]+)/.exec(
      installStackCommand(),
    );
    const packages = install![1]!.split(/\s+/).filter((p) => /^[a-z0-9][a-z0-9+.-]+$/.test(p));
    expect(packages.length).toBeGreaterThan(3);
    expect(packages.filter((name) => !words.has(name))).toEqual([]);
    expect(dockerfile).toContain("google-chrome-stable_current_amd64.deb");
  });

  it("leaves the install markers the app checks", () => {
    expect(dockerfile).toContain(`ARG BROWSER_STACK_VERSION=${STACK_VERSION}`);
    expect(dockerfile).toContain(`ARG COMPUTER_STACK_VERSION=${COMPUTER_STACK_VERSION}`);
  });

  it("serves the user the app dials, by key only, on loopback only", () => {
    const sshd = readFileSync(join(dir, "sshd_config"), "utf8");
    expect(sshd).toMatch(/^AllowUsers exedev$/m);
    expect(sshd).toMatch(/^PasswordAuthentication no$/m);
    // The browser and computer live views are direct-tcpip channels.
    expect(sshd).toMatch(/^AllowTcpForwarding (local|yes)$/m);
    const compose = readFileSync(join(dir, "compose.yml"), "utf8");
    expect(compose).toContain('"127.0.0.1:${SANDBOX_LOCAL_PORT:-2222}:22"');
  });
});
