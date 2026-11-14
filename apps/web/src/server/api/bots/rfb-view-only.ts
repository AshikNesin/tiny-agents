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
 */

export class RfbViewOnlyError extends Error {}

type Phase = "version" | "security" | "init" | "messages";

export interface RfbViewOnlyFilter {
  /** Feed bytes from the viewer; returns what may reach the desktop. Throws `RfbViewOnlyError`. */
  push(chunk: Buffer): Buffer;
}

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

export function createRfbViewOnlyFilter(): RfbViewOnlyFilter {
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
        if (FORWARD.has(pending[0]!)) out.push(pending.subarray(0, length));
        pending = pending.subarray(length);
      }
      // Keep only what is still unread, copied off the chunks it came from.
      pending = Buffer.from(pending);
      return out.length === 1 ? out[0]! : Buffer.concat(out);
    },
  };
}
