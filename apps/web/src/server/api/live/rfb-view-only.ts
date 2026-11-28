export class RfbViewOnlyError extends Error {}

type Phase = "version" | "security" | "init" | "messages";

export interface RfbViewOnlyFilter {
  push(chunk: Buffer): Buffer;
}

const FORWARD: ReadonlySet<number> = new Set([0, 2, 3, 150, 248]);

const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;

function messageLength(buf: Buffer): number | undefined {
  const type = buf[0]!;
  const need = (n: number) => (buf.length >= n ? n : undefined);
  const clamp = (length: number): number | undefined => {
    if (length > MAX_MESSAGE_BYTES) throw new RfbViewOnlyError("That RFB message is too long.");
    return need(length);
  };
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
      if (length > MAX_MESSAGE_BYTES) throw new RfbViewOnlyError("That RFB message is too long.");
      return need(8 + length);
    }
    case 150:
      return need(10);
    case 248:
      return buf.length < 9 ? undefined : clamp(9 + buf[8]!);
    case 250:
      return need(4);
    case 251:
      return buf.length < 7 ? undefined : clamp(8 + 16 * buf[6]!);
    case 255:
      if (buf.length < 2) return undefined;
      if (buf[1] !== 0) throw new RfbViewOnlyError(`Unknown QEMU message ${buf[1]}`);
      return need(12);
    default:
      throw new RfbViewOnlyError(`Unknown RFB message type ${type}`);
  }
}

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
      pending = Buffer.from(pending);
      return out.length === 1 ? out[0]! : Buffer.concat(out);
    },
  };
}

export function createRfbViewOnlyFilter(): RfbViewOnlyFilter {
  return createRfbFramer((type) => FORWARD.has(type));
}

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
