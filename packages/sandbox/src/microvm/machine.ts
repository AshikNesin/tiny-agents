import type { Duplex } from "node:stream";
import ssh2 from "ssh2";
import type { HostKeyStore, SshEndpoint } from "../ssh/connection";
import type { SandboxMachine } from "../ssh/machine";
import { MICROVM_BRIDGE_PORT } from "./bridge";

export type MicrovmState =
  | "PENDING"
  | "RUNNING"
  | "SUSPENDED"
  | "SUSPENDING"
  | "TERMINATED"
  | "TERMINATING";

export interface MicrovmInfo {
  id: string;
  state: MicrovmState;
  endpoint: string;
  startedAt: Date;
  maximumDurationSeconds: number;
}

export interface MicrovmApi {
  run(runHookPayload: string): Promise<MicrovmInfo>;
  get(id: string): Promise<MicrovmInfo | undefined>;
  resume(id: string): Promise<void>;
  authToken(id: string, port: number, expirationInMinutes: number): Promise<string>;
}

export interface MicrovmRecord {
  id: string;
  privateKey: string;
}

export interface MicrovmRecordStore {
  get(): Promise<MicrovmRecord | undefined>;
  set(record: MicrovmRecord): Promise<void>;
}

export type OpenStream = (url: string, headers: Record<string, string>) => Promise<Duplex>;

export interface MicrovmMachineOptions {
  api: MicrovmApi;
  records: MicrovmRecordStore;
  openStream: OpenStream;
  user?: string;
  hostKeys?: HostKeyStore;
  bridgePort?: number;
  replaceMarginMs?: number;
  tokenMinutes?: number;
  startTimeoutMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onReplaced?: (previousId: string, nextId: string) => void;
}

const REPLACE_MARGIN_MS = 30 * 60_000;
const TOKEN_MINUTES = 60;
const TOKEN_REFRESH_MS = 5 * 60_000;
const START_TIMEOUT_MS = 180_000;
const POLL_MS = 1_000;

const GONE: readonly MicrovmState[] = ["TERMINATED", "TERMINATING"];
const ASLEEP: readonly MicrovmState[] = ["SUSPENDED", "SUSPENDING"];

interface Current {
  info: MicrovmInfo;
  privateKey: string;
}

interface Token {
  vmId: string;
  value: string;
  expiresAt: number;
}

function websocketUrl(endpoint: string): string {
  if (endpoint.startsWith("wss://")) return endpoint;
  if (endpoint.startsWith("https://")) return `wss://${endpoint.slice("https://".length)}`;
  return `wss://${endpoint}`;
}

function newKeyPair(): { privateKey: string; publicKey: string } {
  const pair = ssh2.utils.generateKeyPairSync("ed25519", { comment: "tiny-agents-microvm" });
  return { privateKey: pair.private, publicKey: pair.public };
}

export function microvmMachine(options: MicrovmMachineOptions): SandboxMachine {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const bridgePort = options.bridgePort ?? MICROVM_BRIDGE_PORT;
  const replaceMarginMs = options.replaceMarginMs ?? REPLACE_MARGIN_MS;
  const tokenMinutes = options.tokenMinutes ?? TOKEN_MINUTES;
  const startTimeoutMs = options.startTimeoutMs ?? START_TIMEOUT_MS;
  const pollMs = options.pollMs ?? POLL_MS;
  let current: Current | undefined;
  let token: Token | undefined;
  let preparing: Promise<Current> | undefined;

  const endsAt = (info: MicrovmInfo) =>
    info.startedAt.getTime() + info.maximumDurationSeconds * 1000;

  const usable = (info: MicrovmInfo | undefined): info is MicrovmInfo =>
    info !== undefined && !GONE.includes(info.state) && endsAt(info) - now() > replaceMarginMs;

  const waitUntilRunning = async (id: string): Promise<MicrovmInfo> => {
    const deadline = now() + startTimeoutMs;
    for (;;) {
      const info = await options.api.get(id);
      if (!info || GONE.includes(info.state)) {
        throw new Error(`The sandbox MicroVM ${id} ended while starting.`);
      }
      if (info.state === "RUNNING") return info;
      if (now() >= deadline) {
        throw new Error(
          `The sandbox MicroVM ${id} is still ${info.state} after ${Math.round(startTimeoutMs / 1000)}s.`,
        );
      }
      await sleep(pollMs);
    }
  };

  const startNew = async (previousId: string | undefined): Promise<Current> => {
    const { privateKey, publicKey } = newKeyPair();
    const started = await options.api.run(JSON.stringify({ authorizedKey: publicKey }));
    await options.records.set({ id: started.id, privateKey });
    if (previousId && previousId !== started.id) options.onReplaced?.(previousId, started.id);
    return { info: await waitUntilRunning(started.id), privateKey };
  };

  const prepare = async (): Promise<Current> => {
    const record = await options.records.get();
    const info = record ? await options.api.get(record.id) : undefined;
    if (!record || !usable(info)) return startNew(record?.id);
    if (ASLEEP.includes(info.state)) await options.api.resume(record.id);
    const running = info.state === "RUNNING" ? info : await waitUntilRunning(record.id);
    return { info: running, privateKey: record.privateKey };
  };

  const authToken = async (vmId: string): Promise<string> => {
    if (token && token.vmId === vmId && token.expiresAt - now() > TOKEN_REFRESH_MS) {
      return token.value;
    }
    const value = await options.api.authToken(vmId, bridgePort, tokenMinutes);
    token = { vmId, value, expiresAt: now() + tokenMinutes * 60_000 };
    return value;
  };

  return {
    label: "aws-lambda-microvm",

    async ready() {
      preparing ??= prepare().finally(() => {
        preparing = undefined;
      });
      current = await preparing;
    },

    async dial(): Promise<SshEndpoint> {
      if (!current) throw new Error("The sandbox MicroVM is not ready.");
      const { info, privateKey } = current;
      const sock = await options.openStream(websocketUrl(info.endpoint), {
        "X-aws-proxy-auth": await authToken(info.id),
        "X-aws-proxy-port": String(bridgePort),
      });
      return {
        host: info.id,
        user: options.user,
        hostKeys: options.hostKeys,
        privateKey,
        sock,
      };
    },
  };
}
