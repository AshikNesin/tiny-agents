import { describe, expect, it } from "vite-plus/test";
import {
  resetSandboxHostKeysForTests,
  sandboxEndpoint,
  sandboxHost,
} from "../../../../apps/web/src/server/api/bots/sandbox-host";

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
    const env = {
      SANDBOX_HOST: "vm",
      SANDBOX_PORT: "2222",
      SANDBOX_USER: '"ops"',
      NODE_ENV: "test",
    };
    const first = sandboxEndpoint(env);
    const second = sandboxEndpoint(env);
    expect(first).toMatchObject({ host: "vm", port: 2222, user: "ops" });
    // The sandbox toolkit, the terminal and the browser tunnel pin by the same store.
    expect(first?.hostKeys).toBe(second?.hostKeys);
    expect(sandboxEndpoint({ NODE_ENV: "development" })).toBeUndefined();
  });
});
