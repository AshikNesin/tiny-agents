import { lookup } from "node:dns/promises";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { connect, isIP, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { reportFailure } from "./failures";
import type { ResolveHost } from "./navigation-guard";
import { isPrivateAddress } from "./public-url";

export const REFUSED_HEADER = "x-tiny-agents-refused";

export const REFUSED_MESSAGE = "Private and local addresses can't be fetched.";

export const PROXY_BYPASS_FLAG = "--proxy-bypass-list=<-loopback>";

const LOOKUP_TIMEOUT_MS = 5_000;
const DIAL_TIMEOUT_MS = 15_000;

export interface EgressProxyOptions {
  exempt: ReadonlySet<string>;
  resolveHost?: ResolveHost;
}

export interface EgressProxy {
  url: string;
  close(): Promise<void>;
}

type Verdict = { addresses: string[] } | { refused: true } | { failed: string };

const resolveAll: ResolveHost = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("lookup timed out")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function decideEgress(
  host: string,
  exempt: ReadonlySet<string>,
  resolveHost: ResolveHost = resolveAll,
): Promise<Verdict> {
  const lower = host.toLowerCase();
  const bare = lower.replace(/^\[|\]$/g, "");
  const name = bare.replace(/\.+$/, "");
  const exemptName = [lower, bare, name, `[${bare}]`].some((key) => exempt.has(key));
  const exemptAddress = (address: string) => exempt.has(address) || exempt.has(`[${address}]`);
  const addresses = isIP(bare)
    ? Promise.resolve([bare])
    : within(resolveHost(name), LOOKUP_TIMEOUT_MS);
  return addresses.then(
    (list): Verdict => {
      if (list.length === 0) return { failed: `${name} did not resolve` };
      const refused =
        !exemptName && list.some((address) => isPrivateAddress(address) && !exemptAddress(address));
      return refused ? { refused: true } : { addresses: [...new Set(list)] };
    },
    (error: unknown): Verdict => {
      reportFailure(`the egress proxy could not resolve ${name}, answering 502`, error);
      return { failed: `${name} did not resolve` };
    },
  );
}

function splitAuthority(authority: string): { host: string; port: number } | null {
  const match = /^(\[[^\]]+\]|[^:]+):(\d{1,5})$/.exec(authority);
  if (!match) return null;
  const port = Number(match[2]);
  return port > 0 && port < 65536 ? { host: match[1]!, port } : null;
}

function refuseTunnel(socket: Duplex, status: string, refused: boolean) {
  const header = refused ? `${REFUSED_HEADER}: private-address\r\n` : "";
  socket.end(`HTTP/1.1 ${status}\r\n${header}Content-Length: 0\r\nConnection: close\r\n\r\n`);
}

async function dialAny(
  addresses: readonly string[],
  port: number,
  track: (socket: Socket) => void,
): Promise<Socket> {
  let last: unknown;
  for (const address of addresses) {
    try {
      return await dial(address, port, track);
    } catch (error) {
      last = error;
    }
  }
  throw last;
}

function dial(address: string, port: number, track: (socket: Socket) => void): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: address, port });
    track(socket);
    socket.setTimeout(DIAL_TIMEOUT_MS, () => socket.destroy(new Error("connect timed out")));
    socket.once("connect", () => {
      socket.setTimeout(0);
      resolve(socket);
    });
    socket.once("error", reject);
  });
}

export async function startEgressProxy(options: EgressProxyOptions): Promise<EgressProxy> {
  const { exempt, resolveHost } = options;
  const open = new Set<Duplex>();
  let closed = false;
  const track = (socket: Duplex) => {
    if (closed) return void socket.destroy();
    open.add(socket);
    socket.once("close", () => open.delete(socket));
  };

  const forward = async (req: IncomingMessage, res: ServerResponse) => {
    let target: URL;
    try {
      target = new URL(req.url ?? "");
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (target.protocol !== "http:") {
      res.writeHead(400).end();
      return;
    }
    const verdict = await decideEgress(target.hostname, exempt, resolveHost);
    if ("refused" in verdict) {
      res.writeHead(403, { [REFUSED_HEADER]: "private-address", "content-type": "text/plain" });
      res.end(REFUSED_MESSAGE);
      return;
    }
    if ("failed" in verdict) {
      res.writeHead(502, { "content-type": "text/plain" }).end(verdict.failed);
      return;
    }
    const headers = { ...req.headers };
    delete headers["proxy-connection"];
    delete headers["proxy-authorization"];
    let socket: Socket;
    try {
      socket = await dialAny(verdict.addresses, Number(target.port) || 80, track);
    } catch {
      res.writeHead(502).end();
      return;
    }
    res.once("close", () => socket.destroy());
    const upstream = httpRequest({
      createConnection: () => socket,
      method: req.method,
      path: `${target.pathname}${target.search}`,
      headers,
      setHost: false,
      timeout: DIAL_TIMEOUT_MS,
    });
    upstream.once("timeout", () => upstream.destroy(new Error("upstream timed out")));
    upstream.once("response", (reply) => {
      reply.once("end", () => socket.destroy());
      res.writeHead(reply.statusCode ?? 502, reply.rawHeaders);
      reply.pipe(res);
    });
    upstream.once("error", () => {
      if (res.headersSent) res.destroy();
      else res.writeHead(502).end();
    });
    req.pipe(upstream);
  };

  const tunnel = async (req: IncomingMessage, client: Duplex, head: Buffer) => {
    track(client);
    client.on("error", () => client.destroy());
    const authority = splitAuthority(req.url ?? "");
    if (!authority) return refuseTunnel(client, "400 Bad Request", false);
    const verdict = await decideEgress(authority.host, exempt, resolveHost);
    if ("refused" in verdict) return refuseTunnel(client, "403 Forbidden", true);
    if ("failed" in verdict) return refuseTunnel(client, "502 Bad Gateway", false);
    let upstream: Socket;
    try {
      upstream = await dialAny(verdict.addresses, authority.port, track);
    } catch {
      return refuseTunnel(client, "502 Bad Gateway", false);
    }
    if (client.destroyed) return void upstream.destroy();
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length > 0) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
    upstream.on("error", () => client.destroy());
    client.once("close", () => upstream.destroy());
    upstream.once("close", () => client.destroy());
  };

  const server = createServer(
    (req, res) =>
      void forward(req, res).catch((error: unknown) => {
        reportFailure(
          `the egress proxy failed on a request to ${req.headers.host ?? "an unnamed host"}, dropping it`,
          error,
        );
        res.destroy();
      }),
  );
  server.on("connect", (req, socket, head) => {
    void tunnel(req, socket, head).catch((error: unknown) => {
      reportFailure(
        `the egress proxy failed tunnelling to ${req.url ?? "a host"}, dropping it`,
        error,
      );
      socket.destroy();
    });
  });
  server.on("connection", track);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("The browser proxy did not bind");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        closed = true;
        for (const socket of open) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
