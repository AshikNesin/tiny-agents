/**
 * The Claude plan worker for this server: on the sandbox VM (or the local
 * sandbox container), set up over the same SSH endpoint the browser, the
 * computer and the terminal use. The app installs Node, the Agent SDK and
 * Claude Code there on first use, uploads the worker and reaches it through
 * an SSH tunnel; the owner only signs Claude Code in (Settings → Claude plan).
 *
 * The worker ships as one file. The production build emits it next to the
 * bundle as `claude-worker.mjs` (scripts/build.mjs); dev bundles the
 * TypeScript entry with esbuild on first use.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createSandboxClaudeWorker, type ClaudeWorkerLocator } from "@tiny-agents/agent";
import { sandboxEndpoint } from "./sandbox-host";

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
  const endpoint = sandboxEndpoint(env);
  if (!endpoint) return undefined;
  const port = Number(env.CLAUDE_SANDBOX_WORKER_PORT);
  return createSandboxClaudeWorker({
    endpoint,
    script: claudeWorkerScript,
    ...(Number.isInteger(port) && port > 0 ? { port } : {}),
  });
}
