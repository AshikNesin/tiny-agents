import {
  isSupervisorMessage,
  type ServerMessage,
  type UpdateView,
} from "../../../shared/local-updates";
import { app } from "../../app-root";

export interface SupervisorChannel {
  send(message: ServerMessage): void;
  onMessage(listener: (message: unknown) => void): () => void;
}

export const SUPERVISED_ENV = "TINY_AGENTS_SUPERVISED";

export function processChannel(supervised: boolean): SupervisorChannel | undefined {
  if (!supervised || !process.send || !process.connected) return undefined;
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

export function startUpdates(next: SupervisorChannel | undefined): () => void {
  stopUpdates();
  const root = app();
  root.updatesChannel = next;
  if (!next) return stopUpdates;
  root.updatesUnlisten = next.onMessage((message) => {
    if (isSupervisorMessage(message)) root.updateStatus = message.status;
  });
  next.send({ type: "server-ready" });
  return stopUpdates;
}

function stopUpdates(): void {
  const root = app();
  root.updatesUnlisten();
  root.updatesUnlisten = () => {};
  root.updatesChannel = undefined;
  root.updateStatus = null;
}

export function updateView(): UpdateView {
  const { updatesChannel, updateStatus } = app();
  return { supervised: updatesChannel !== undefined, status: updateStatus };
}

export function requestCheck(): boolean {
  const channel = app().updatesChannel;
  channel?.send({ type: "update-check" });
  return channel !== undefined;
}

export function requestApply(): boolean {
  const channel = app().updatesChannel;
  channel?.send({ type: "update-apply" });
  return channel !== undefined;
}
