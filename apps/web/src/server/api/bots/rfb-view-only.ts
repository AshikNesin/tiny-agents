/**
 * A view-only filter for what a VNC viewer sends to the desktop (S2): it
 * forwards the handshake and the messages that only ask for pictures, and
 * drops every input message (keys, pointer, clipboard, resize, power). A
 * guest's viewer runs behind it, so a shared bot's browser or desktop, which
 * holds the owner's logins, can be watched but never driven, whatever the
 * client claims.
 *
 * Client-to-server RFB (RFC 6143 plus the extensions noVNC 1.7 sends):
 * - handshake: the 12-byte version, then (3.7 and later) the chosen security
 *   type, which must be None (1), then the 1-byte ClientInit;
 * - 0 SetPixelFormat (20), 2 SetEncodings (4 + 4n), 3 FramebufferUpdateRequest
 *   (10), 150 EnableContinuousUpdates (10), 248 Fence (9 + n): forwarded;
 * - 4 KeyEvent (8), 5 PointerEvent (6, or 7 with the extended marker bit),
 *   6 ClientCutText (8 + n, n negative for extended clipboard), 250 xvp (4),
 *   251 SetDesktopSize (8 + 16n), 255 QEMU extended key event (12): dropped.
 *
 * Anything else cannot be framed, so the filter fails and the bridge closes
 * the viewer rather than guess.
 *
 * The owner's viewer runs behind the same framing with nothing dropped
 * (`createRfbInputWatch`): its input messages are what tell the idle sweep
 * the owner is still driving.
 */

export class RfbViewOnlyError extends Error {}

type Phase = "version" | "security" | "init" | "messages";

export interface RfbViewOnlyFilter {
  /** Feed bytes from the viewer; returns what may reach the desktop. Throws `RfbViewOnlyError`. */
  push(chunk: Buffer): Buffer;
}

/** Messages that only ask for pictures; every other type is input. */
const FORWARD = new Set([0, 2, 3, 150, 248]);

/** The full length of the message at the start of `buf`, or undefined until enough has arrived. */
function messageLength(buf: Buffer): number | undefined {
  const type = buf[0]!;
  const need = (n: number) => (buf.length >= n ? n : undefined);
  switch (type) {
    case 0:
      return need(20);
    case 2:
      return buf.length < 4 ? undefined : need(4 + 4 * buf.readUInt16BE(2));
    case 3:
      return need(10);
    case 4:
      return need(8);
    case 5:
      return buf.length < 2 ? undefined : need(buf[1]! & 0x80 ? 7 : 6);
    case 6: {
      if (buf.length < 8) return undefined;
      const raw = buf.readUInt32BE(4);
      const length = raw >= 0x8000_0000 ? 0x1_0000_0000 - raw : raw;
      return need(8 + length);
    }
    case 150:
      return need(10);
    case 248:
      return buf.length < 9 ? undefined : need(9 + buf[8]!);
    case 250:
      return need(4);
    case 251:
      return buf.length < 7 ? undefined : need(8 + 16 * buf[6]!);
    case 255:
      if (buf.length < 2) return undefined;
      if (buf[1] !== 0) throw new RfbViewOnlyError(`Unknown QEMU message ${buf[1]}`);
      return need(12);
    default:
      throw new RfbViewOnlyError(`Unknown RFB message type ${type}`);
  }
}

/** Frames the viewer's bytes; `keep` says whether a whole message (by its type) reaches the desktop. */
function createRfbFramer(keep: (type: number) => boolean): RfbViewOnlyFilter {
  let phase: Phase = "version";
  let pending: Buffer = Buffer.alloc(0);

  return {
    push(chunk) {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      const out: Buffer[] = [];
      for (;;) {
        if (phase === "version") {
          if (pending.length < 12) break;
          const version = pending.subarray(0, 12).toString("latin1");
          const match = /^RFB (\d{3})\.(\d{3})\n$/.exec(version);
          if (!match) throw new RfbViewOnlyError("Not an RFB version");
          out.push(pending.subarray(0, 12));
          pending = pending.subarray(12);
          // RFB 3.3: the server picks the security type; the client sends none.
          phase = Number(match[1]) === 3 && Number(match[2]) < 7 ? "init" : "security";
          continue;
        }
        if (phase === "security") {
          if (pending.length < 1) break;
          if (pending[0] !== 1) throw new RfbViewOnlyError("Only security type None is relayed");
          out.push(pending.subarray(0, 1));
          pending = pending.subarray(1);
          phase = "init";
          continue;
        }
        if (phase === "init") {
          if (pending.length < 1) break;
          out.push(pending.subarray(0, 1));
          pending = pending.subarray(1);
          phase = "messages";
          continue;
        }
        if (pending.length < 1) break;
        const length = messageLength(pending);
        if (length === undefined) break;
        if (keep(pending[0]!)) out.push(pending.subarray(0, length));
        pending = pending.subarray(length);
      }
      // Keep only what is still unread, copied off the chunks it came from.
      pending = Buffer.from(pending);
      return out.length === 1 ? out[0]! : Buffer.concat(out);
    },
  };
}

export function createRfbViewOnlyFilter(): RfbViewOnlyFilter {
  return createRfbFramer((type) => FORWARD.has(type));
}

/**
 * Reads the owner's viewer alongside the bridge, which forwards every byte
 * untouched, and calls `onInput` for each input message. A message it cannot
 * frame stops the watch, never the viewer: from then on every chunk counts
 * as input.
 */
export function createRfbInputWatch(onInput: () => void): { push(chunk: Buffer): void } {
  const framer = createRfbFramer((type) => {
    if (!FORWARD.has(type)) onInput();
    return false;
  });
  let framing = true;
  return {
    push(chunk) {
      if (framing) {
        try {
          framer.push(chunk);
          return;
        } catch (error) {
          if (!(error instanceof RfbViewOnlyError)) throw error;
          framing = false;
        }
      }
      onInput();
    },
  };
}
