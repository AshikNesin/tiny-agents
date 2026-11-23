import {
  isSupervisorMessage,
  type ServerMessage,
  type UpdateView,
} from "../../../shared/local-updates";
import { app } from "../../app-root";

export interface SupervisorChannel {
  send(message: ServerMessage): boolean;
  onMessage(listener: (message: unknown) => void): () => void;
  onDisconnect(listener: () => void): () => void;
}

export const SUPERVISED_ENV = "TINY_AGENTS_SUPERVISED";

export function processChannel(supervised: boolean): SupervisorChannel | undefined {
  if (!supervised || !process.send || !process.connected) return undefined;
  process.channel?.unref();
  return {
    send: (message) => {
      if (!process.connected) return false;
      try {
        return process.send?.(message) ?? false;
      } catch {
        return false;
      }
    },
    onMessage: (listener) => {
      process.on("message", listener);
      return () => process.off("message", listener);
    },
    onDisconnect: (listener) => {
      const gone = () => listener();
      process.on("disconnect", gone);
      process.on("error", gone);
      return () => {
        process.off("disconnect", gone);
        process.off("error", gone);
      };
    },
  };
}

export function startUpdates(next: SupervisorChannel | undefined): () => void {
  stopUpdates();
  const root = app();
  root.updatesChannel = next;
  if (!next) return stopUpdates;
  root.updatesUnlisten = () => {
    unlistenMessage();
    unlistenDisconnect();
  };
  const unlistenMessage = next.onMessage((message) => {
    if (isSupervisorMessage(message)) root.updateStatus = message.status;
  });
  const unlistenDisconnect = next.onDisconnect(() => {
    if (app().updatesChannel !== next) return;
    stopUpdates();
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
  return deliver({ type: "update-check" });
}

export function requestApply(): boolean {
  return deliver({ type: "update-apply" });
}

function deliver(message: ServerMessage): boolean {
  const channel = app().updatesChannel;
  if (!channel || !channel.send(message)) {
    stopUpdates();
    return false;
  }
  return true;
}
