import { resolve } from "node:path";
import { shelley } from "@tiny-agents/code/server";
import type { EditorSshTarget } from "../../../shared/api/code";
import { appEnv, type AppEnv } from "../../env";
import { sandboxHost, unquoteEnv } from "../bots/sandbox-host";

function remoteHost(host: string | undefined): string | null {
  if (!host) return null;
  return /^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1|\[::1\])$/i.test(host) ? null : host;
}

function urlHost(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch (error) {
    if (error instanceof TypeError) return undefined;
    throw error;
  }
}

function sandboxTarget(env: AppEnv): EditorSshTarget | null {
  const host = sandboxHost(env);
  if (!host) return null;
  const port = Number(env.SANDBOX_PORT);
  const keyFile = unquoteEnv(env.SANDBOX_SSH_KEY_FILE);
  return {
    host: remoteHost(host),
    user: unquoteEnv(env.SANDBOX_USER) ?? null,
    port: Number.isInteger(port) && port > 0 && port !== 22 ? port : null,
    keyFile: keyFile ? resolve(keyFile) : null,
  };
}

const APP_HOST: EditorSshTarget = { host: null, user: null, port: null, keyFile: null };

export function editorSshTarget(kind: string, env: AppEnv = appEnv()): EditorSshTarget {
  const sandbox = sandboxTarget(env);
  if (kind !== "shelley") return sandbox ?? APP_HOST;
  const host = remoteHost(urlHost(shelley.trimUrl(env.SHELLEY_URL)));
  if (host) return { ...APP_HOST, host };
  return sandbox && sandbox.host === null ? sandbox : APP_HOST;
}
