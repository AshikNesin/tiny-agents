import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  resetSandboxHostKeysForTests,
  sandboxConnection,
  sandboxEndpoint,
  sandboxHost,
  sandboxPrivateKey,
} from "../../../../apps/web/src/server/api/sandbox/sandbox-host";
import { appEnv } from "../../../../apps/web/src/server/env";

describe("sandboxHost", () => {
  it("uses an explicit host anywhere, unquoted", () => {
    expect(sandboxHost({ SANDBOX_HOST: "100.77.69.117", NODE_ENV: "development" })).toBe(
      "100.77.69.117",
    );
    expect(sandboxHost({ SANDBOX_HOST: '"my-vm"', NODE_ENV: "production" })).toBe("my-vm");
  });

  it("keeps the MagicDNS default in production, even for an empty value", () => {
    expect(sandboxHost({ NODE_ENV: "production" })).toBe("tiny-agents-vm");
    expect(sandboxHost({ SANDBOX_HOST: "", NODE_ENV: "production" })).toBe("tiny-agents-vm");
  });

  it("means no sandbox elsewhere when unset or empty", () => {
    expect(sandboxHost({ NODE_ENV: "development" })).toBeUndefined();
    expect(sandboxHost({ SANDBOX_HOST: "  ", NODE_ENV: "test" })).toBeUndefined();
  });
});

describe("sandboxEndpoint", () => {
  it("is one endpoint with one host-key store for every SSH user", () => {
    resetSandboxHostKeysForTests();
    const env = appEnv({
      SANDBOX_HOST: "vm",
      SANDBOX_PORT: "2222",
      SANDBOX_USER: '"ops"',
      NODE_ENV: "test",
    });
    const first = sandboxEndpoint(env);
    const second = sandboxEndpoint(env);
    expect(first).toMatchObject({ host: "vm", port: 2222, user: "ops" });
    expect(first?.hostKeys).toBe(second?.hostKeys);
    expect(sandboxEndpoint({ NODE_ENV: "development" })).toBeUndefined();
  });
});

describe("sandboxConnection", () => {
  it("is one connection per endpoint, shared by every SSH user, and none without a host", () => {
    resetSandboxHostKeysForTests();
    const env = appEnv({ SANDBOX_HOST: "vm", SANDBOX_PORT: "2222", NODE_ENV: "test" });
    const first = sandboxConnection(env);
    expect(first?.host).toBe("vm");
    expect(sandboxConnection({ ...env })).toBe(first);
    expect(sandboxConnection({ ...env, SANDBOX_PORT: "2223" })).not.toBe(first);
    expect(sandboxConnection({ NODE_ENV: "development" })).toBeUndefined();
    resetSandboxHostKeysForTests();
  });
});

describe("sandboxPrivateKey", () => {
  const PEM =
    "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaA==\n-----END OPENSSH PRIVATE KEY-----\n";

  it("is unset by default: keyless Tailscale SSH", () => {
    expect(sandboxPrivateKey(appEnv({ SANDBOX_HOST: "vm" }))).toBeUndefined();
    expect(sandboxEndpoint(appEnv({ SANDBOX_HOST: "vm" }))?.privateKey).toBeUndefined();
  });

  it("takes an inline key, with \\n escapes from a one-line env file", () => {
    const oneLine = PEM.trim().replaceAll("\n", "\\n");
    expect(sandboxPrivateKey(appEnv({ SANDBOX_SSH_KEY: `"${oneLine}"` }))).toBe(PEM);
  });

  it("reads a key file, and the endpoint carries it to every SSH user", () => {
    resetSandboxHostKeysForTests();
    const dir = mkdtempSync(join(tmpdir(), "sandbox-key-"));
    try {
      const file = join(dir, "id_ed25519");
      writeFileSync(file, PEM);
      const env = appEnv({
        SANDBOX_HOST: "127.0.0.1",
        SANDBOX_PORT: "2222",
        SANDBOX_SSH_KEY_FILE: file,
      });
      expect(sandboxEndpoint(env)).toMatchObject({
        host: "127.0.0.1",
        port: 2222,
        privateKey: PEM,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("logs an unreadable key file once instead of throwing", () => {
    resetSandboxHostKeysForTests();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const env = appEnv({ SANDBOX_SSH_KEY_FILE: join(tmpdir(), "no-such-sandbox-key") });
      expect(sandboxPrivateKey(env)).toBeUndefined();
      expect(sandboxPrivateKey(env)).toBeUndefined();
      expect(error).toHaveBeenCalledTimes(1);
      expect(String(error.mock.calls[0]![0])).toContain("pnpm sandbox:up");
    } finally {
      error.mockRestore();
    }
  });
});
