import {
  CreateMicrovmAuthTokenCommand,
  GetMicrovmCommand,
  LambdaMicrovmsClient,
  ResourceNotFoundException,
  ResumeMicrovmCommand,
  RunMicrovmCommand,
  type LambdaMicrovmsClientConfig,
} from "@aws-sdk/client-lambda-microvms";
import type { MicrovmApi, MicrovmInfo, MicrovmState } from "./machine";

export interface MicrovmAwsOptions {
  region: string;
  credentials?: LambdaMicrovmsClientConfig["credentials"];
  image: string;
  imageVersion?: string;
  egressConnectors?: string[];
  maximumDurationSeconds?: number;
  idleSuspendSeconds?: number;
}

const MAXIMUM_DURATION_SECONDS = 8 * 60 * 60;
const IDLE_SUSPEND_SECONDS = 15 * 60;
const AUTH_HEADER = "X-aws-proxy-auth";

interface Described {
  microvmId?: string;
  state?: string;
  endpoint?: string;
  startedAt?: Date;
  maximumDurationInSeconds?: number;
}

const STATES: readonly MicrovmState[] = [
  "PENDING",
  "RUNNING",
  "SUSPENDED",
  "SUSPENDING",
  "TERMINATED",
  "TERMINATING",
];

const isState = (state: string): state is MicrovmState =>
  (STATES as readonly string[]).includes(state);

function toInfo(described: Described): MicrovmInfo {
  const { microvmId, state, endpoint, startedAt, maximumDurationInSeconds } = described;
  if (!microvmId || !state || !endpoint || !startedAt || !maximumDurationInSeconds) {
    throw new Error(`AWS described MicroVM ${microvmId ?? "(no id)"} without all its fields.`);
  }
  if (!isState(state))
    throw new Error(`AWS reported MicroVM ${microvmId} in unknown state ${state}.`);
  return {
    id: microvmId,
    state,
    endpoint,
    startedAt,
    maximumDurationSeconds: maximumDurationInSeconds,
  };
}

function absentWhenNotFound(error: unknown): undefined {
  if (error instanceof ResourceNotFoundException) return undefined;
  throw error;
}

export function microvmAwsApi(options: MicrovmAwsOptions): MicrovmApi {
  const client = new LambdaMicrovmsClient({
    region: options.region,
    ...(options.credentials ? { credentials: options.credentials } : {}),
  });
  const maximumDurationSeconds = options.maximumDurationSeconds ?? MAXIMUM_DURATION_SECONDS;
  const idleSuspendSeconds = options.idleSuspendSeconds ?? IDLE_SUSPEND_SECONDS;

  return {
    async run(runHookPayload) {
      const started = await client.send(
        new RunMicrovmCommand({
          imageIdentifier: options.image,
          imageVersion: options.imageVersion,
          egressNetworkConnectors: options.egressConnectors,
          maximumDurationInSeconds: maximumDurationSeconds,
          idlePolicy: {
            autoResumeEnabled: true,
            maxIdleDurationSeconds: idleSuspendSeconds,
            suspendedDurationSeconds: maximumDurationSeconds,
          },
          runHookPayload,
        }),
      );
      return toInfo(started);
    },

    async get(id) {
      const described = await client
        .send(new GetMicrovmCommand({ microvmIdentifier: id }))
        .catch(absentWhenNotFound);
      return described ? toInfo(described) : undefined;
    },

    async resume(id) {
      await client.send(new ResumeMicrovmCommand({ microvmIdentifier: id }));
    },

    async authToken(id, port, expirationInMinutes) {
      const { authToken } = await client.send(
        new CreateMicrovmAuthTokenCommand({
          microvmIdentifier: id,
          expirationInMinutes,
          allowedPorts: [{ port }],
        }),
      );
      const value = authToken?.[AUTH_HEADER];
      if (!value) throw new Error(`AWS returned no ${AUTH_HEADER} token for MicroVM ${id}.`);
      return value;
    },
  };
}
