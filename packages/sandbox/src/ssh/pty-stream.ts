/**
 * A pty channel as a plain duplex (issue #28): reads and writes pass through
 * untouched, `setWindow` drives the channel's window-change request, and
 * destroying the stream closes only its channel (the connection is shared).
 */
import { Duplex } from "node:stream";
import type { ClientChannel } from "ssh2";

/**
 * A live pty: a duplex of raw bytes. `setWindow` follows a client resize
 * through to the pty; `done` settles when the remote side ends (the program
 * exited or detached this client) carrying its exit code, so a bridge can
 * tell a failed attach (nonzero, no bytes) from a detach.
 */
export interface PtyStream extends Duplex {
  setWindow(rows: number, cols: number): void;
  done: Promise<{ exitCode: number | null }>;
}

/** The pty a command asks for. */
export interface PtySize {
  term: string;
  cols: number;
  rows: number;
}

export class ChannelPtyStream extends Duplex implements PtyStream {
  private ended = false;
  readonly done: Promise<{ exitCode: number | null }>;

  constructor(
    private readonly channel: ClientChannel,
    private readonly release: () => void,
  ) {
    // Not half-open: when the remote side ends (tmux exited, a missing
    // session, the tmux client was detached), the stream must close, or the
    // bridge never learns the tab is gone.
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
    try {
      this.channel.close();
    } catch {
      // The channel can already be gone (its connection closed).
    }
    this.release();
    callback(error);
  }
}
