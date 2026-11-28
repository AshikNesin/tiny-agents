import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  createSandboxClaudeWorker,
  type ClaudeWorkerLocator,
} from "@tiny-agents/agent/claude-worker";
import { sandboxConnection } from "./sandbox-host";
import { appEnv, type AppEnv } from "../../env";
import { app } from "../../app-root";

const WORKER_EXTERNALS = ["@anthropic-ai/claude-agent-sdk", "ws", "zod"];

async function bundleFromSource(): Promise<string> {
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

async function claudeWorkerScript(): Promise<string> {
  const here = import.meta.url;
  if (!here.endsWith(".ts")) return readFile(new URL("./claude-worker.mjs", here), "utf8");
  return bundleFromSource();
}

export function sharedClaudeWorkerLocator(env: AppEnv = appEnv()): ClaudeWorkerLocator | undefined {
  const connection = sandboxConnection(env);
  if (!connection) return undefined;
  const root = app();
  if (root.claudeWorker?.connection !== connection) {
    root.claudeWorker = {
      connection,
      locator: createSandboxClaudeWorker({ connection, script: claudeWorkerScript }),
    };
  }
  return root.claudeWorker.locator;
}
