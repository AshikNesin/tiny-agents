/**
 * What a protocol on the worker socket sees. The server (`server.ts`) owns
 * the sockets, the bearer check, `welcome`, the heartbeat and the framing;
 * each protocol (the bot protocol, `bot-handler.ts`; the coding protocol,
 * `coding-handler.ts`) is a `ProtocolHandler` that answers its messages on a
 * `Peer` and subscribes an `Audience` of sockets to its sessions' logs.
 */
import type { WebSocket } from "ws";
import type { CodingWorkerMessage } from "./coding-protocol";
import type { EnvelopeFrame } from "./envelope";
import type { WorkerMessage } from "./protocol";
import type { Sequenced, SessionLog } from "./session-log";

export type OutboundMessage = EnvelopeFrame | WorkerMessage | CodingWorkerMessage;

/** How a protocol puts one of its session events on the wire. */
export type EventFrame<E> = (event: Sequenced<E>) => OutboundMessage;

/** One socket, as a protocol sees it. Frames to a closed socket are dropped. */
export class Peer {
  constructor(private readonly socket: WebSocket) {}

  send(message: OutboundMessage): void {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(JSON.stringify(message));
  }

  /** The one `reply` a request gets, when it succeeded. */
  reply(requestId: string, result: unknown): void {
    this.send({ type: "reply", requestId, ok: true, ...(result === undefined ? {} : { result }) });
  }

  /** The one `reply` a request gets, when it failed. */
  refuse(requestId: string, code: string, message: string): void {
    this.send({ type: "reply", requestId, ok: false, error: { code, message } });
  }

  /** A resume's replay: the log's kept events after `afterSeq`, to this socket only. */
  replay<E>(log: SessionLog<E> | undefined, afterSeq: number, frame: EventFrame<E>): void {
    for (const event of log?.replay(afterSeq) ?? []) this.send(frame(event));
  }
}

/** The sockets that follow a protocol's sessions. */
export class Audience {
  private readonly peers = new Set<Peer>();
  private readonly followed = new WeakSet<object>();

  add(peer: Peer): void {
    this.peers.add(peer);
  }

  delete(peer: Peer): void {
    this.peers.delete(peer);
  }

  broadcast(message: OutboundMessage): void {
    for (const peer of this.peers) peer.send(message);
  }

  /** Send every event this log appends from now on to every peer. Once per log. */
  follow<E>(log: SessionLog<E>, frame: EventFrame<E>): void {
    if (this.followed.has(log)) return;
    this.followed.add(log);
    log.subscribe((event) => this.broadcast(frame(event)));
  }
}

/** One protocol on the worker socket. */
export interface ProtocolHandler {
  /** True for a parsed message this protocol answers. */
  claims(message: unknown): boolean;
  handle(message: unknown, peer: Peer): Promise<void>;
  /** Evict idle processes. */
  sweep(now: number): void;
  /** The server is closing. */
  close(): void;
}
