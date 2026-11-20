import type { WebSocket } from "ws";
import type { CodingWorkerMessage } from "./coding-protocol";
import type { EnvelopeFrame } from "./envelope";
import type { WorkerMessage } from "./protocol";
import type { Sequenced, SessionLog } from "./session-log";

export type OutboundMessage = EnvelopeFrame | WorkerMessage | CodingWorkerMessage;

export type EventFrame<E> = (event: Sequenced<E>) => OutboundMessage;

export class Peer {
  constructor(private readonly socket: WebSocket) {}

  send(message: OutboundMessage): void {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(JSON.stringify(message));
  }

  reply(requestId: string, result: unknown): void {
    this.send({ type: "reply", requestId, ok: true, ...(result === undefined ? {} : { result }) });
  }

  refuse(requestId: string, code: string, message: string): void {
    this.send({ type: "reply", requestId, ok: false, error: { code, message } });
  }

  replay<E>(log: SessionLog<E> | undefined, afterSeq: number, frame: EventFrame<E>): void {
    for (const event of log?.replay(afterSeq) ?? []) this.send(frame(event));
  }
}

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

  follow<E>(log: SessionLog<E>, frame: EventFrame<E>): void {
    if (this.followed.has(log)) return;
    this.followed.add(log);
    log.subscribe((event) => this.broadcast(frame(event)));
  }
}

export interface ProtocolHandler {
  claims(message: unknown): boolean;
  handle(message: unknown, peer: Peer): Promise<void>;
  sweep(now: number): void;
  close(): void;
}
