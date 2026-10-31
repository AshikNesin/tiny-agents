/**
 * The shared SSH dial, against a fake ssh2 Client class: the error listener
 * outlives the handshake (ssh2 emits a second, fatal error after a timeout,
 * and an unhandled one would crash the server), and host keys are pinned
 * on first use and refused when they change.
 */
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vite-plus/test";
import {
  createMemoryHostKeyStore,
  dialSsh,
  hostKeyHash,
  verifyHostKey,
} from "../../../../packages/agent/src/ssh/connection";

type ConnectConfig = {
  host: string;
  hostVerifier?: (key: Buffer, verify: (ok: boolean) => void) => void;
};

/** A fake Client class whose handshake the test drives by hand. */
function fakeSsh2(key = Buffer.from("host-key-A")) {
  const clients: FakeClient[] = [];
  class FakeClient extends EventEmitter {
    config!: ConnectConfig;
    ended = false;
    constructor() {
      super();
      clients.push(this);
    }
    connect(config: ConnectConfig): this {
      this.config = config;
      queueMicrotask(() => {
        if (!config.hostVerifier) {
          this.emit("ready");
          return;
        }
        config.hostVerifier(key, (ok) => {
          if (ok) this.emit("ready");
          else this.emit("error", new Error("Host key rejected"));
        });
      });
      return this;
    }
    end(): void {
      this.ended = true;
    }
  }
  return { Client: FakeClient as never, clients };
}

describe("dialSsh", () => {
  it("keeps handling errors after ready, so a late ssh2 error cannot crash the process", async () => {
    const ssh = fakeSsh2();
    const client = await dialSsh({ host: "vm" }, ssh.Client);
    // An EventEmitter with no 'error' listener throws here; ours must not.
    expect(() => client.emit("error", new Error("Connection lost"))).not.toThrow();
    expect(() => client.emit("error", new Error("Connection lost again"))).not.toThrow();
  });

  it("rejects once on a failed handshake and swallows the second error", async () => {
    const ssh = fakeSsh2();
    class Failing extends (ssh.Client as new () => EventEmitter & {
      end(): void;
      ended: boolean;
    }) {
      override connect(): this {
        queueMicrotask(() => {
          this.emit("error", new Error("Timed out while waiting for handshake"));
          this.emit("close");
          this.emit("error", new Error("Connection lost before handshake"));
        });
        return this;
      }
    }
    await expect(dialSsh({ host: "vm" }, Failing as never)).rejects.toThrow("handshake");
    expect(ssh.clients[0]!.ended).toBe(true);
  });

  it("pins the host key on first use and refuses a changed one", async () => {
    const hostKeys = createMemoryHostKeyStore();
    const first = fakeSsh2(Buffer.from("host-key-A"));
    await dialSsh({ host: "vm", hostKeys }, first.Client);
    expect(await hostKeys.get("vm")).toBe(hostKeyHash(Buffer.from("host-key-A")));

    const same = fakeSsh2(Buffer.from("host-key-A"));
    await expect(dialSsh({ host: "vm", hostKeys }, same.Client)).resolves.toBeDefined();

    const changed = fakeSsh2(Buffer.from("host-key-B"));
    await expect(dialSsh({ host: "vm", hostKeys }, changed.Client)).rejects.toThrow(
      /host key changed/,
    );
    expect(changed.clients[0]!.ended).toBe(true);
    // One store, one pin per host: the same rule for every SSH user.
    await expect(verifyHostKey(hostKeys, "vm", Buffer.from("host-key-A"))).resolves.toBeUndefined();
  });
});
