import { Duplex } from "node:stream";
import type { ClientChannel } from "ssh2";
import { alreadyClosed } from "../failures";

export interface PtyStream extends Duplex {
  setWindow(rows: number, cols: number): void;
  done: Promise<{ exitCode: number | null }>;
}

export interface PtySize {
  term: string;
  cols: number;
  rows: number;
}

export function closeChannel(channel: ClientChannel): void {
  try {
    channel.close();
  } catch (error) {
    alreadyClosed("closing an SSH channel")(error);
  }
}

export class ChannelPtyStream extends Duplex implements PtyStream {
  private ended = false;
  readonly done: Promise<{ exitCode: number | null }>;

  constructor(
    private readonly channel: ClientChannel,
    private readonly release: () => void,
  ) {
    super({ allowHalfOpen: false });
    let resolveDone!: (value: { exitCode: number | null }) => void;
    this.done = new Promise((resolve) => {
      resolveDone = resolve;
    });
    channel.on("data", (b: Buffer) => {
      if (!this.ended) this.push(b);
    });
    channel.once("close", (code: number | null) => {
      this.ended = true;
      this.push(null);
      resolveDone({ exitCode: code });
      this.release();
    });
    channel.on("error", () => {
      this.ended = true;
      this.push(null);
      resolveDone({ exitCode: null });
      this.release();
    });
  }

  setWindow(rows: number, cols: number): void {
    if (this.ended) return;
    this.channel.setWindow(rows, cols, 0, 0);
  }

  override _read(): void {
    this.channel.resume();
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    if (this.ended) return callback();
    const ok = this.channel.write(chunk);
    if (ok) callback();
    else this.channel.once("drain", () => callback());
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.ended = true;
    closeChannel(this.channel);
    this.release();
    callback(error);
  }
}
