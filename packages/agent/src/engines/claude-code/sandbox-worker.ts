/**
 * Where the Claude Code worker lives, and how the app reaches it.
 *
 * The default is the sandbox: the same VM (or local sandbox container) the
 * browser, computer and terminal already use. The app installs Node, the
 * Agent SDK and Claude Code there over SSH on first use, uploads the worker,
 * starts it on the sandbox's loopback, and connects through an SSH
 * direct-tcpip tunnel. Nothing is published: no `tailscale serve`, no
 * token to copy. The owner signs Claude Code in once, in a terminal tab,
 * and Claude Code keeps that login on the sandbox.
 */
import { createHash } from "node:crypto";
import type { Server } from "node:net";
import type { Duplex } from "node:stream";
import type { Client } from "ssh2";
import { isSubscriptionLogin, parseAuthStatus, LOGIN_HINT } from "@tiny-agents/claude-worker";
import { dialSsh, type SshEndpoint } from "../../ssh/connection";
import { createForwardingServer } from "../../toolkits/browser-remote-cdp";
import {
  authStatusCommand,
  DEFAULT_SANDBOX_WORKER_PORT,
  ensureWorkerCommand,
  installWorkerCommand,
  parseEnsureOutput,
  uploadWorkerCommand,
} from "./sandbox-setup";

/** A worker the engine can open a WebSocket to. */
export interface ClaudeWorkerTarget {
  url: string;
  token: string;
}

/** What Settings shows about the Claude login. Never a credential. */
export type ClaudeAccountStatus =
  /** No sandbox: nowhere to run Claude Code. */
  | { state: "unconfigured" }
  /** First use: Node, the SDK and Claude Code are going onto the sandbox. */
  | { state: "installing" }
  | { state: "error"; detail: string }
  | {
      state: "ready";
      loggedIn: boolean;
      subscription: boolean;
      plan?: string;
      detail?: string;
    };

export type ClaudeWorkerMode = "sandbox" | "none";

/** The engine's view of the worker: where it is and how to reach it. */
export interface ClaudeWorkerLocator {
  readonly mode: ClaudeWorkerMode;
  /** Host shown in Settings (no secrets). */
  readonly host?: string;
  /** Reach the worker, setting it up first when needed. Throws with a readable reason. */
  resolve(): Promise<ClaudeWorkerTarget>;
  /** Start setting up ahead of the first turn. Never throws. */
  prepare(): void;
  account(): Promise<ClaudeAccountStatus>;
  close(): void;
}

export const noWorkerLocator: ClaudeWorkerLocator = {
  mode: "none",
  resolve: () =>
    Promise.reject(
      new Error(
        "Claude subscription engine has no sandbox to run on. Set SANDBOX_HOST (or run `pnpm sandbox:up`).",
      ),
    ),
  prepare: () => {},
  account: async () => ({ state: "unconfigured" }),
  close: () => {},
};

export interface SandboxWorkerOptions {
  endpoint: SshEndpoint;
  /** The bundled worker (`dist/server/claude-worker.mjs`); read once and uploaded when it changes. */
  script: () => Promise<string>;
  /** Port inside the sandbox. Default 8765. */
  port?: number;
  /** Test hook: dial a fake SSH server. */
  dial?: (endpoint: SshEndpoint) => Promise<Client>;
}

/** First-run budget: a Node download plus `npm install` of the SDK and Claude Code. */
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const EXEC_TIMEOUT_MS = 45_000;

/** Run one command on a fresh connection; `stdin` is written then closed. */
async function execOn(
  dial: () => Promise<Client>,
  command: string,
  timeoutMs: number,
  label: string,
  stdin?: string,
): Promise<string> {
  const client = await dial();
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Sandbox timed out: ${label}`)), timeoutMs);
      client.exec(command, (error, channel) => {
        if (error) {
          clearTimeout(timer);
          reject(error);
          return;
        }
        let out = "";
        let err = "";
        channel.on("data", (d: Buffer) => (out += d.toString("utf8")));
        channel.stderr.on("data", (d: Buffer) => (err += d.toString("utf8")));
        channel.on("exit", (code: number | null) => {
          clearTimeout(timer);
          // Backgrounded children can keep the channel from closing; settle
          // shortly after exit with what arrived.
          setTimeout(() => {
            if (code === 0) resolve(out.trim());
            else {
              const detail = (err || out).trim().slice(-800);
              reject(new Error(`Could not ${label} on the sandbox${detail ? `: ${detail}` : ""}`));
            }
          }, 50);
        });
        if (stdin !== undefined) channel.end(stdin);
        else channel.end();
      });
    });
  } finally {
    client.end();
  }
}

/**
 * The worker on the sandbox, set up on demand. `resolve()` returns a
 * loopback URL on this machine; each WebSocket to it is carried by its own
 * SSH connection to the worker's port on the sandbox (the same pattern as
 * the browser's CDP tunnel), and a refused channel re-runs the start check,
 * so a sandbox that rebooted gets its worker back on the next reconnect.
 */
export function createSandboxClaudeWorker(options: SandboxWorkerOptions): ClaudeWorkerLocator {
  const port = options.port ?? DEFAULT_SANDBOX_WORKER_PORT;
  const dial = () => (options.dial ?? dialSsh)(options.endpoint);
  let script: Promise<{ body: string; sha: string }> | undefined;
  let ensured: Promise<string> | undefined;
  let installing = false;
  let lastError: string | undefined;
  let server: Server | undefined;
  let local: Promise<number> | undefined;
  const live = new Set<Client>();

  const bundle = () =>
    (script ??= options.script().then((body) => ({
      body,
      sha: createHash("sha256").update(body).digest("hex").slice(0, 32),
    })));

  /** Install, upload and start as needed; resolves with the worker's token. */
  const ensureOnce = async (): Promise<string> => {
    const { body, sha } = await bundle();
    for (let step = 0; step < 4; step++) {
      const result = parseEnsureOutput(
        await execOn(
          dial,
          ensureWorkerCommand(sha, port),
          EXEC_TIMEOUT_MS,
          "start the Claude worker",
        ),
      );
      if (result.state === "ok") return result.token;
      if (result.state === "missing") {
        installing = true;
        try {
          await execOn(dial, installWorkerCommand(), INSTALL_TIMEOUT_MS, "install Claude Code");
        } finally {
          installing = false;
        }
      } else {
        await execOn(
          dial,
          uploadWorkerCommand(sha),
          EXEC_TIMEOUT_MS,
          "upload the Claude worker",
          body,
        );
      }
    }
    throw new Error("The Claude worker did not come up on the sandbox.");
  };

  const ensure = (): Promise<string> => {
    if (!ensured) {
      const attempt = ensureOnce();
      ensured = attempt;
      attempt.then(
        () => (lastError = undefined),
        (error: unknown) => {
          lastError = error instanceof Error ? error.message : String(error);
          // Never cache a failure: the next call tries again.
          if (ensured === attempt) ensured = undefined;
        },
      );
    }
    return ensured;
  };

  const forward = async (): Promise<Duplex> => {
    const client = await dial();
    live.add(client);
    return new Promise<Duplex>((resolve, reject) => {
      client.forwardOut("127.0.0.1", 0, "127.0.0.1", port, (error, channel) => {
        if (error) {
          live.delete(client);
          client.end();
          reject(error);
          return;
        }
        channel.once("close", () => {
          live.delete(client);
          client.end();
        });
        resolve(channel);
      });
    });
  };

  /** One tunnelled socket. A refusal means the worker is gone: start it and retry once. */
  const openChannel = async (): Promise<Duplex> => {
    await ensure();
    try {
      return await forward();
    } catch {
      ensured = undefined;
      await ensure();
      return forward();
    }
  };

  const localPort = (): Promise<number> =>
    (local ??= new Promise<number>((resolve, reject) => {
      const fwd = createForwardingServer(openChannel);
      server = fwd;
      fwd.once("error", reject);
      fwd.listen(0, "127.0.0.1", () => {
        const address = fwd.address();
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("Could not bind a local port for the Claude worker tunnel"));
      });
    }));

  return {
    mode: "sandbox",
    host: options.endpoint.host,
    async resolve() {
      const token = await ensure();
      return { url: `ws://127.0.0.1:${await localPort()}`, token };
    },
    prepare() {
      void ensure().catch(() => {});
    },
    async account() {
      if (installing) return { state: "installing" };
      if (!ensured) this.prepare();
      // Ask the CLI while setup runs; a not-yet-installed CLI prints nothing.
      try {
        await Promise.race([ensured, new Promise((resolve) => setTimeout(resolve, 1500))]);
      } catch {
        return { state: "error", detail: lastError ?? "Claude Code could not be set up." };
      }
      if (installing) return { state: "installing" };
      let output: string;
      try {
        output = await execOn(dial, authStatusCommand(), EXEC_TIMEOUT_MS, "read the Claude login");
      } catch (error) {
        return { state: "error", detail: error instanceof Error ? error.message : String(error) };
      }
      if (!output) {
        return lastError ? { state: "error", detail: lastError } : { state: "installing" };
      }
      const status = parseAuthStatus(output);
      const subscription = isSubscriptionLogin(status);
      return {
        state: "ready",
        loggedIn: status.loggedIn,
        subscription,
        ...(status.subscriptionType ? { plan: status.subscriptionType } : {}),
        ...(subscription ? {} : { detail: LOGIN_HINT }),
      };
    },
    close() {
      for (const client of live) client.end();
      live.clear();
      server?.close();
      server = undefined;
      local = undefined;
    },
  };
}
