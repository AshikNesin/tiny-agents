import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { connect, type Socket } from "node:net";
import { parseJson } from "@tiny-agents/std";
import { createWebSocketStream, WebSocketServer } from "ws";
import { z } from "zod";

export const HOOK_PREFIX = "/aws/lambda-microvms/runtime/v1/";
export const MICROVM_BRIDGE_PORT = 8080;
const MAX_RUN_PAYLOAD_BYTES = 16 * 1024;
const PROBE_TIMEOUT_MS = 2_000;

const RunPayload = z.object({ authorizedKey: z.string().startsWith("ssh-") });

export interface MicrovmBridgeOptions {
  sshPort: number;
  sshHost?: string;
  authorize(publicKey: string): Promise<void>;
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error(`The run payload is over ${limit} bytes.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sshAccepts(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.setTimeout(PROBE_TIMEOUT_MS, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

function reply(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(message);
}

function pipeToSsh(stream: ReturnType<typeof createWebSocketStream>, socket: Socket): void {
  const closeBoth = () => {
    stream.destroy();
    socket.destroy();
  };
  stream.on("error", closeBoth);
  socket.on("error", closeBoth);
  stream.on("close", closeBoth);
  socket.on("close", closeBoth);
  stream.pipe(socket).pipe(stream);
}

export function createMicrovmBridge(options: MicrovmBridgeOptions): Server {
  const sshHost = options.sshHost ?? "127.0.0.1";
  let authorized = false;

  const runHook = async (req: IncomingMessage, res: ServerResponse) => {
    if (authorized) {
      reply(res, 409, "This VM already has its key.");
      return;
    }
    const body = await readBody(req, MAX_RUN_PAYLOAD_BYTES);
    const { authorizedKey } = parseJson("The run payload", body, RunPayload);
    await options.authorize(authorizedKey.trim());
    authorized = true;
    reply(res, 200, "authorized");
  };

  const hook = async (name: string, req: IncomingMessage, res: ServerResponse) => {
    if (name === "run") return runHook(req, res);
    if (name === "ready" || name === "validate") {
      const up = await sshAccepts(sshHost, options.sshPort);
      reply(res, up ? 200 : 503, up ? "ready" : "sshd is not accepting connections yet");
      return;
    }
    if (name === "resume" || name === "suspend" || name === "terminate") {
      reply(res, 200, "ok");
      return;
    }
    reply(res, 404, "Unknown hook.");
  };

  const answerHookFailure = (res: ServerResponse) => (error: Error) =>
    reply(res, res.headersSent ? 500 : 400, error.message);

  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://bridge").pathname;
    if (!path.startsWith(HOOK_PREFIX)) {
      reply(res, 404, "Not found.");
      return;
    }
    void hook(path.slice(HOOK_PREFIX.length), req, res).catch(answerHookFailure(res));
  });

  const sockets = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    sockets.handleUpgrade(req, socket, head, (ws) => {
      pipeToSsh(
        createWebSocketStream(ws),
        connect({ host: sshHost, port: options.sshPort, noDelay: true }),
      );
    });
  });
  server.on("close", () => sockets.close());
  return server;
}
