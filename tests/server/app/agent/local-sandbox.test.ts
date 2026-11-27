import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  installStackCommand,
  STACK_VERSION,
} from "../../../../packages/sandbox/src/browser-vm-setup";
import {
  COMPUTER_PACKAGES,
  COMPUTER_STACK_VERSION,
} from "../../../../packages/sandbox/src/computer-vm-setup";

import {
  CLAUDE_WORKER_NODE_VERSION,
  CLAUDE_WORKER_PACKAGES,
  CLAUDE_WORKER_STACK_VERSION,
} from "../../../../packages/agent/src/engines/claude-code/sandbox-setup";

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

  it("turns off Chrome's password manager on the VM and in the image", () => {
    const dirs = ["/etc/opt/chrome/policies/managed", "/etc/chromium/policies/managed"];
    const policy = JSON.parse(readFileSync(join(dir, "chrome-policy.json"), "utf8"));
    expect(policy).toEqual({ PasswordManagerEnabled: false });
    for (const path of dirs) {
      expect(dockerfile).toContain(`COPY chrome-policy.json ${path}/tiny-agents.json`);
      expect(installStackCommand()).toContain(`sudo -n tee ${path}/tiny-agents.json`);
    }
    expect(installStackCommand()).toContain(`'{"PasswordManagerEnabled":false}'`);
  });

  it("leaves the install markers the app checks", () => {
    expect(dockerfile).toContain(`ARG BROWSER_STACK_VERSION=${STACK_VERSION}`);
    expect(dockerfile).toContain(`ARG COMPUTER_STACK_VERSION=${COMPUTER_STACK_VERSION}`);
  });

  it("preinstalls Claude Code at the pins the app checks for", () => {
    const pins = CLAUDE_WORKER_PACKAGES;
    expect(dockerfile).toContain(`ARG CLAUDE_WORKER_STACK_VERSION=${CLAUDE_WORKER_STACK_VERSION}`);
    expect(dockerfile).toContain(`ARG CLAUDE_WORKER_NODE_VERSION=${CLAUDE_WORKER_NODE_VERSION}`);
    expect(dockerfile).toContain(
      `ARG CLAUDE_AGENT_SDK_VERSION=${pins["@anthropic-ai/claude-agent-sdk"]}`,
    );
    expect(dockerfile).toContain(`ARG CLAUDE_CODE_VERSION=${pins["@anthropic-ai/claude-code"]}`);
    expect(dockerfile).toContain(`ARG CLAUDE_WORKER_WS_VERSION=${pins.ws}`);
    expect(dockerfile).toContain(`ARG CLAUDE_WORKER_ZOD_VERSION=${pins.zod}`);
    expect(Object.keys(pins).sort()).toEqual(
      ["@anthropic-ai/claude-agent-sdk", "@anthropic-ai/claude-code", "ws", "zod"].sort(),
    );
    expect(dockerfile).toContain("/opt/tiny-agents/claude-worker");
  });

  it("installs Shelley and starts it on loopback, unless turned off", () => {
    expect(dockerfile).toContain(
      "/usr/local/lib/tiny-agents/install-shelley /usr/local/bin/shelley",
    );
    const install = readFileSync(join(dir, "install-shelley.sh"), "utf8");
    expect(install).toContain("releases/latest/download");
    expect(install).toContain("checksums.txt");
    const run = readFileSync(join(dir, "shelley-run.sh"), "utf8");
    expect(run).toContain('"$HOME/.local/bin/shelley" /usr/local/bin/shelley');
    expect(run).toContain('install-shelley "$HOME/.local/bin/shelley"');
    const entrypoint = readFileSync(join(dir, "entrypoint.sh"), "utf8");
    expect(entrypoint).toMatch(/SANDBOX_SHELLEY:-1\}" != 0/);
    expect(entrypoint).toContain("runuser -u exedev");
    expect(entrypoint.indexOf("shelley-run")).toBeLessThan(
      entrypoint.indexOf("exec /usr/sbin/sshd"),
    );
    expect(entrypoint).toMatch(/^unset SHELLEY_ANTHROPIC_API_KEY/m);
    const compose = readFileSync(join(dir, "compose.yml"), "utf8");
    expect(compose).toContain('"127.0.0.1:${SANDBOX_SHELLEY_PORT:-9000}:9000"');
    expect(compose).not.toMatch(/^\s+ANTHROPIC_API_KEY:/m);
  });

  it("installs gh and codex at build time and again on start when missing", () => {
    expect(dockerfile).toContain('/usr/local/lib/tiny-agents/install-clis "$CODEX_VERSION"');
    const install = readFileSync(join(dir, "install-clis.sh"), "utf8");
    expect(install).toMatch(/for tool in gh codex; do\n\s+if have "\$tool"/);
    expect(install).toContain("https://cli.github.com/packages");
    expect(install).toContain("github.com/openai/codex/releases/latest/download");
    const entrypoint = readFileSync(join(dir, "entrypoint.sh"), "utf8");
    expect(entrypoint).toMatch(/SANDBOX_CLIS:-1\}" != 0/);
    expect(entrypoint).toMatch(/install-clis [^\n]*&$/m);
    expect(entrypoint.indexOf("install-clis")).toBeLessThan(
      entrypoint.indexOf("exec /usr/sbin/sshd"),
    );
  });

  it("serves the user the app dials, by key only, on loopback only", () => {
    const sshd = readFileSync(join(dir, "sshd_config"), "utf8");
    expect(sshd).toMatch(/^AllowUsers exedev$/m);
    expect(sshd).toMatch(/^PasswordAuthentication no$/m);
    expect(sshd).toMatch(/^AllowTcpForwarding (local|yes)$/m);
    const compose = readFileSync(join(dir, "compose.yml"), "utf8");
    expect(compose).toContain('"127.0.0.1:${SANDBOX_LOCAL_PORT:-2222}:22"');
  });
});
