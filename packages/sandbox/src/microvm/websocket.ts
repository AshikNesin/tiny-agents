import type { Duplex } from "node:stream";
import { createWebSocketStream, WebSocket } from "ws";

const OPEN_TIMEOUT_MS = 15_000;

export function openWebSocketStream(
  url: string,
  headers: Record<string, string>,
  timeoutMs = OPEN_TIMEOUT_MS,
): Promise<Duplex> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers, handshakeTimeout: timeoutMs });
    const fail = (error: Error) => {
      ws.terminate();
      reject(error);
    };
    ws.once("open", () => {
      ws.off("error", fail);
      resolve(createWebSocketStream(ws));
    });
    ws.once("unexpected-response", (_req, res) =>
      fail(new Error(`The sandbox endpoint refused the connection (HTTP ${res.statusCode}).`)),
    );
    ws.once("error", fail);
  });
}
