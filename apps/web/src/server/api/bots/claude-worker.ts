/**
 * The Claude plan worker for this server: on the sandbox VM (or the local
 * sandbox container), set up over the same sandbox connection the browser,
 * the computer and the terminal use. The app installs Node, the Agent SDK and
 * Claude Code there on first use, uploads the worker and reaches it through
 * an SSH tunnel; the owner only signs Claude Code in (Settings → Claude plan).
 *
 * The worker ships as one file. The production build emits it next to the
 * bundle as `claude-worker.mjs` (scripts/build.mjs); dev bundles the
 * TypeScript entry with esbuild on first use.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  createSandboxClaudeWorker,
  type ClaudeWorkerLocator,
} from "@tiny-agents/agent/claude-worker";
import type { SandboxConnection } from "@tiny-agents/agent/sandbox";
import { sandboxConnection } from "./sandbox-host";

type Env = Readonly<Record<string, string | undefined>>;

/** Packages the worker loads from its own `node_modules` on the sandbox. */
export const WORKER_EXTERNALS = ["@anthropic-ai/claude-agent-sdk", "ws", "zod"];

async function bundleFromSource(): Promise<string> {
  // A variable specifier keeps esbuild (a dev dependency) out of the
  // production bundle, which never takes this path.
  const name = "esbuild";
  const esbuild = (await import(name)) as typeof import("esbuild");
  const entry = fileURLToPath(
    new URL("../../../../../../packages/claude-worker/src/bin.ts", import.meta.url),
  );
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: WORKER_EXTERNALS,
    write: false,
    logLevel: "silent",
  });
  return result.outputFiles[0]!.text;
}

/** The worker script uploaded to the sandbox. */
export async function claudeWorkerScript(): Promise<string> {
  const here = import.meta.url;
  if (!here.endsWith(".ts")) return readFile(new URL("./claude-worker.mjs", here), "utf8");
  return bundleFromSource();
}

/** The sandbox worker, or undefined when no sandbox is configured. */
export function claudeWorkerLocator(env: Env = process.env): ClaudeWorkerLocator | undefined {
  const connection = sandboxConnection(env);
  if (!connection) return undefined;
  return createSandboxClaudeWorker({ connection, script: claudeWorkerScript });
}

let shared: { connection: SandboxConnection; locator: ClaudeWorkerLocator } | undefined;

/**
 * The process's one worker locator: bot chats (the Claude plan engine) and
 * the Code page's Claude Code harness share the worker on the sandbox and
 * its tunnel (ADR 0012), so it is set up once.
 */
export function sharedClaudeWorkerLocator(env: Env = process.env): ClaudeWorkerLocator | undefined {
  const connection = sandboxConnection(env);
  if (!connection) return undefined;
  if (shared?.connection !== connection) {
    shared = {
      connection,
      locator: createSandboxClaudeWorker({ connection, script: claudeWorkerScript }),
    };
  }
  return shared.locator;
}
