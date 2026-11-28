import { createHash } from "node:crypto";
import type { Server } from "node:net";
import type { Duplex } from "node:stream";
import { isSubscriptionLogin, parseAuthStatus, LOGIN_HINT } from "@tiny-agents/claude-worker";
import {
  createForwardingServer,
  failureDetail,
  SandboxTimeoutError,
  type SandboxConnection,
} from "@tiny-agents/sandbox";
import {
  authStatusCommand,
  DEFAULT_SANDBOX_WORKER_PORT,
  ensureWorkerCommand,
  installWorkerCommand,
  parseEnsureOutput,
  uploadWorkerCommand,
} from "./sandbox-setup";

export interface ClaudeWorkerTarget {
  url: string;
  token: string;
}

export type ClaudeAccountStatus =
  | { state: "unconfigured" }
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

export interface ClaudeWorkerLocator {
  readonly mode: ClaudeWorkerMode;
  readonly host?: string;
  resolve(): Promise<ClaudeWorkerTarget>;
  prepare(): void;
  account(): Promise<ClaudeAccountStatus>;
  invalidate(): void;
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
  invalidate: () => {},
  close: () => {},
};

export interface SandboxWorkerOptions {
  connection: SandboxConnection;
  script: () => Promise<string>;
  port?: number;
}

const INSTALL_TIMEOUT_MS = 10 * 60_000;
const EXEC_TIMEOUT_MS = 45_000;

async function execOn(
  connection: SandboxConnection,
  command: string,
  timeoutMs: number,
  label: string,
  stdin?: string,
): Promise<string> {
  let result;
  try {
    result = await connection.exec(command, { stdin, timeoutMs, settleOnExit: true });
  } catch (error) {
    if (error instanceof SandboxTimeoutError)
      throw new Error(`Sandbox timed out: ${label}`, { cause: error });
    throw error;
  }
  const out = result.stdout.toString("utf8");
  if (result.exitCode === 0) return out.trim();
  const detail = failureDetail(result, 800);
  throw new Error(`Could not ${label} on the sandbox${detail ? `: ${detail}` : ""}`);
}

export function createSandboxClaudeWorker(options: SandboxWorkerOptions): ClaudeWorkerLocator {
  const port = options.port ?? DEFAULT_SANDBOX_WORKER_PORT;
  const { connection } = options;
  let script: Promise<{ body: string; sha: string }> | undefined;
  let ensured: Promise<string> | undefined;
  let installing = false;
  let lastError: string | undefined;
  let server: Server | undefined;
  let local: Promise<number> | undefined;
  const live = new Set<Duplex>();

  const bundle = () =>
    (script ??= options.script().then((body) => ({
      body,
      sha: createHash("sha256").update(body).digest("hex").slice(0, 32),
    })));

  const ensureOnce = async (): Promise<string> => {
    const { body, sha } = await bundle();
    for (let step = 0; step < 4; step++) {
      const result = parseEnsureOutput(
        await execOn(
          connection,
          ensureWorkerCommand(sha, port),
          EXEC_TIMEOUT_MS,
          "start the Claude worker",
        ),
      );
      if (result.state === "ok") return result.token;
      if (result.state === "missing") {
        installing = true;
        try {
          await execOn(
            connection,
            installWorkerCommand(),
            INSTALL_TIMEOUT_MS,
            "install Claude Code",
          );
        } finally {
          installing = false;
        }
      } else {
        await execOn(
          connection,
          uploadWorkerCommand(sha),
          EXEC_TIMEOUT_MS,
          "upload the Claude worker",
          body,
        );
      }
    }
    throw new Error("The Claude worker did not come up on the sandbox.");
  };

  const keptAsLastError = (): void => undefined;

  const ensure = (): Promise<string> => {
    if (!ensured) {
      const attempt = ensureOnce();
      ensured = attempt;
      attempt.then(
        () => (lastError = undefined),
        (error: unknown) => {
          lastError = error instanceof Error ? error.message : String(error);
          if (ensured === attempt) ensured = undefined;
        },
      );
    }
    return ensured;
  };

  const forward = async (): Promise<Duplex> => {
    const tunnel = await connection.forward(port);
    live.add(tunnel);
    tunnel.once("close", () => live.delete(tunnel));
    return tunnel;
  };

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
    host: connection.host,
    async resolve() {
      const token = await ensure();
      return { url: `ws://127.0.0.1:${await localPort()}`, token };
    },
    prepare() {
      void ensure().catch(keptAsLastError);
    },
    invalidate() {
      script = undefined;
      ensured = undefined;
      lastError = undefined;
    },
    async account() {
      if (installing) return { state: "installing" };
      if (!ensured) this.prepare();
      let wait: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([ensured, new Promise((resolve) => (wait = setTimeout(resolve, 1500)))]);
      } catch {
        return { state: "error", detail: lastError ?? "Claude Code could not be set up." };
      } finally {
        clearTimeout(wait);
      }
      if (installing) return { state: "installing" };
      let output: string;
      try {
        output = await execOn(
          connection,
          authStatusCommand(),
          EXEC_TIMEOUT_MS,
          "read the Claude login",
        );
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
      for (const tunnel of live) tunnel.destroy();
      live.clear();
      server?.close();
      server = undefined;
      local = undefined;
      this.invalidate();
    },
  };
}
