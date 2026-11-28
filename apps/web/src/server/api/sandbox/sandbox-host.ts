import { readFileSync } from "node:fs";
import { createNamespaceKv } from "@groot/core/kv";
import { fromWebToken, type FromWebTokenInit } from "@aws-sdk/credential-provider-web-identity";
import {
  createMemoryHostKeyStore,
  createSandboxConnection,
  type HostKeyStore,
  type SandboxConnection,
  type SandboxMachine,
  type SshEndpoint,
  sshMachine,
} from "@tiny-agents/sandbox";
import {
  microvmAwsApi,
  microvmMachine,
  openWebSocketStream,
  type MicrovmAwsOptions,
  type MicrovmRecord,
  type MicrovmRecordStore,
} from "@tiny-agents/sandbox/microvm";
import { appEnv, type AppEnv } from "../../env";
import { app } from "../../app-root";
import { OIDC_SANDBOX_SUBJECT, oidcIssuer, signOidcToken } from "../system/oidc";

export const unquoteEnv = (value: string | undefined) =>
  value
    ?.trim()
    .replace(/^(['"])([\s\S]*)\1$/, "$2")
    .trim() || undefined;

function sandboxProvider(env: AppEnv = appEnv()): "ssh" | "microvm" {
  return env.SANDBOX_PROVIDER ?? "ssh";
}

export function sandboxHost(env: AppEnv = appEnv()): string | undefined {
  if (sandboxProvider(env) === "microvm") return undefined;
  return (
    unquoteEnv(env.SANDBOX_HOST) ?? (env.NODE_ENV === "production" ? "tiny-agents-vm" : undefined)
  );
}

function sandboxHostKeys(): HostKeyStore {
  const root = app();
  if (root.sandboxHostKeys) return root.sandboxHostKeys;
  try {
    const kv = createNamespaceKv("SANDBOX");
    root.sandboxHostKeys = {
      async get(host) {
        return (await kv.get<string>(host)) ?? undefined;
      },
      async set(host, hash) {
        await kv.set(host, hash);
      },
    };
  } catch {
    root.sandboxHostKeys = createMemoryHostKeyStore();
  }
  return root.sandboxHostKeys;
}

export function sandboxPrivateKey(env: AppEnv = appEnv()): string | undefined {
  const inline = unquoteEnv(env.SANDBOX_SSH_KEY);
  if (inline) return `${inline.replaceAll("\\n", "\n").trim()}\n`;
  const path = unquoteEnv(env.SANDBOX_SSH_KEY_FILE);
  if (!path) return undefined;
  const keyFiles = app().sandboxKeyFiles;
  if (keyFiles.has(path)) return keyFiles.get(path) || undefined;
  let key = "";
  try {
    key = readFileSync(path, "utf8");
  } catch (error) {
    console.error(
      `SANDBOX_SSH_KEY_FILE ${path} can't be read (${(error as Error).message}). ` +
        "Run `pnpm sandbox:up` to create the local sandbox's key, or unset it for Tailscale SSH.",
    );
  }
  keyFiles.set(path, key);
  return key || undefined;
}

export function sandboxEndpoint(env: AppEnv = appEnv()): SshEndpoint | undefined {
  const host = sandboxHost(env);
  if (!host) return undefined;
  return {
    host,
    port: env.SANDBOX_PORT ? Number(env.SANDBOX_PORT) : undefined,
    user: unquoteEnv(env.SANDBOX_USER),
    hostKeys: sandboxHostKeys(),
    privateKey: sandboxPrivateKey(env),
  };
}

export function sandboxConfigured(env: AppEnv = appEnv()): boolean {
  return sandboxProvider(env) === "microvm" ? true : Boolean(sandboxHost(env));
}

interface MicrovmSettings {
  region: string;
  image: string;
  imageVersion?: string;
  egressConnectors?: string[];
  user?: string;
  auth: "oidc" | "default";
  roleArn?: string;
  issuer?: string;
}

export function microvmSettings(env: AppEnv = appEnv()): MicrovmSettings {
  const missing = (name: string) =>
    new Error(`SANDBOX_PROVIDER=microvm needs ${name}. See docs/reference/config.md.`);
  const region = unquoteEnv(env.SANDBOX_MICROVM_REGION);
  const image = unquoteEnv(env.SANDBOX_MICROVM_IMAGE);
  if (!region) throw missing("SANDBOX_MICROVM_REGION");
  if (!image) throw missing("SANDBOX_MICROVM_IMAGE");
  const auth = env.SANDBOX_AWS_AUTH ?? "oidc";
  const roleArn = unquoteEnv(env.SANDBOX_MICROVM_ROLE_ARN);
  if (auth === "oidc" && !roleArn)
    throw missing("SANDBOX_MICROVM_ROLE_ARN (or SANDBOX_AWS_AUTH=default)");
  const egress = unquoteEnv(env.SANDBOX_MICROVM_EGRESS_CONNECTOR);
  return {
    region,
    image,
    imageVersion: unquoteEnv(env.SANDBOX_MICROVM_IMAGE_VERSION),
    egressConnectors: egress ? [egress] : undefined,
    user: unquoteEnv(env.SANDBOX_USER),
    auth,
    roleArn,
    issuer: oidcIssuer(env),
  };
}

type RoleAssumer = FromWebTokenInit["roleAssumerWithWebIdentity"];

export function sandboxAwsCredentials(
  settings: MicrovmSettings,
  roleAssumerWithWebIdentity?: RoleAssumer,
): MicrovmAwsOptions["credentials"] {
  if (settings.auth === "default") return undefined;
  const { roleArn, issuer, region } = settings;
  if (!roleArn || !issuer) throw new Error("OIDC sign-in needs a role ARN and an issuer.");
  return async () =>
    fromWebToken({
      roleArn,
      roleSessionName: "tiny-agents-sandbox",
      webIdentityToken: await signOidcToken(issuer, OIDC_SANDBOX_SUBJECT),
      clientConfig: { region },
      roleAssumerWithWebIdentity,
    })();
}

const MICROVM_RECORD = "microvm";

function microvmRecords(): MicrovmRecordStore {
  const store = createNamespaceKv("SANDBOX");
  return {
    get: () => store.get<MicrovmRecord>(MICROVM_RECORD),
    set: (record) => store.set(MICROVM_RECORD, record),
  };
}

function logReplacedMicrovm(previousId: string, nextId: string): void {
  console.warn(
    `[sandbox] MicroVM ${previousId} is near its 8-hour limit; new sandbox work runs on ${nextId}. ` +
      "Files, browser logins and terminal tabs on the old VM are not carried over.",
  );
}

function misconfiguredMachine(error: Error): SandboxMachine {
  return {
    label: "aws-lambda-microvm",
    ready: () => Promise.reject(error),
    dial: () => Promise.reject(error),
  };
}

function microvmSettingsOrProblem(env: AppEnv): MicrovmSettings | Error {
  try {
    return microvmSettings(env);
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
}

function sandboxMachine(env: AppEnv): { key: string; machine: SandboxMachine } | undefined {
  if (sandboxProvider(env) === "microvm") {
    const settings = microvmSettingsOrProblem(env);
    if (settings instanceof Error) {
      return {
        key: JSON.stringify(["microvm", settings.message]),
        machine: misconfiguredMachine(settings),
      };
    }
    const machine = microvmMachine({
      api: microvmAwsApi({ ...settings, credentials: sandboxAwsCredentials(settings) }),
      records: microvmRecords(),
      openStream: openWebSocketStream,
      user: settings.user,
      hostKeys: sandboxHostKeys(),
      onReplaced: logReplacedMicrovm,
    });
    return { key: JSON.stringify(["microvm", settings]), machine };
  }
  const endpoint = sandboxEndpoint(env);
  if (!endpoint) return undefined;
  const { host, port, user, privateKey } = endpoint;
  return { key: JSON.stringify([host, port, user, privateKey]), machine: sshMachine(endpoint) };
}

export function sandboxConnection(env: AppEnv = appEnv()): SandboxConnection | undefined {
  const connections = app().sandboxConnections;
  const target = sandboxMachine(env);
  if (!target) return undefined;
  let connection = connections.get(target.key);
  if (!connection) {
    connection = createSandboxConnection(target.machine);
    connections.set(target.key, connection);
  }
  return connection;
}

export function closeSandboxConnections(): void {
  const connections = app().sandboxConnections;
  for (const connection of connections.values()) connection.close();
  connections.clear();
}

export function resetSandboxHostKeysForTests(): void {
  app().sandboxHostKeys = undefined;
  app().sandboxKeyFiles.clear();
  closeSandboxConnections();
}
