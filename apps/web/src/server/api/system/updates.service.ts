/**
 * The server's half of local self-updates (docs/guides/local-updates.md).
 * Under `pnpm local` the server has an IPC channel to the supervisor: it
 * receives the update status and asks for checks and updates. Started any
 * other way (`pnpm start`, a container) there is no channel and the Settings
 * page says how to turn updates on.
 */
import {
  isSupervisorMessage,
  type ServerMessage,
  type UpdateStatus,
  type UpdateView,
} from "../../../shared/local-updates";

/** The IPC channel to the supervisor; `process` when forked by it. */
export interface SupervisorChannel {
  send(message: ServerMessage): void;
  onMessage(listener: (message: unknown) => void): () => void;
}

let channel: SupervisorChannel | undefined;
let status: UpdateStatus | null = null;
let unlisten = () => {};

/** The env var `pnpm local` sets on the server it starts. */
export const SUPERVISED_ENV = "TINY_AGENTS_SUPERVISED";

/**
 * The IPC channel to `pnpm local`, or undefined. `supervised` is the
 * `SUPERVISED_ENV` flag: other parents (pm2, a test runner) have IPC too.
 */
export function processChannel(supervised: boolean): SupervisorChannel | undefined {
  if (!supervised || !process.send || !process.connected) return undefined;
  // The channel must not keep the process alive once the lifecycle stops.
  process.channel?.unref();
  return {
    send: (message) => {
      if (process.connected) process.send?.(message);
    },
    onMessage: (listener) => {
      process.on("message", listener);
      return () => process.off("message", listener);
    },
  };
}

/** Attach to the supervisor (if any) and tell it the server is up. */
export function startUpdates(next: SupervisorChannel | undefined): () => void {
  stopUpdates();
  channel = next;
  if (!channel) return stopUpdates;
  unlisten = channel.onMessage((message) => {
    if (isSupervisorMessage(message)) status = message.status;
  });
  channel.send({ type: "server-ready" });
  return stopUpdates;
}

function stopUpdates(): void {
  unlisten();
  unlisten = () => {};
  channel = undefined;
  status = null;
}

export function updateView(): UpdateView {
  return { supervised: channel !== undefined, status };
}

/** Ask the supervisor to fetch the tracked ref. False when not supervised. */
export function requestCheck(): boolean {
  channel?.send({ type: "update-check" });
  return channel !== undefined;
}

/** Ask the supervisor to build the latest commit and restart onto it. */
export function requestApply(): boolean {
  channel?.send({ type: "update-apply" });
  return channel !== undefined;
}
