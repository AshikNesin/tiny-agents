import { describe, expect, it } from "vite-plus/test";
import {
  createRfbInputWatch,
  createRfbViewOnlyFilter,
  RfbViewOnlyError,
} from "../../../../apps/web/src/server/api/bots/rfb-view-only";

const b = (...bytes: number[]) => Buffer.from(bytes);
const HANDSHAKE = Buffer.concat([Buffer.from("RFB 003.008\n"), b(1), b(1)]);

const setPixelFormat = Buffer.concat([b(0), Buffer.alloc(19, 7)]);
const setEncodings = b(2, 0, 0, 2, 0, 0, 0, 7, 0xff, 0xff, 0xff, 0x21);
const updateRequest = b(3, 1, 0, 0, 0, 0, 4, 0, 3, 0);
const continuous = b(150, 1, 0, 0, 0, 0, 4, 0, 3, 0);
const fence = b(248, 0, 0, 0, 0, 0, 0, 1, 2, 0xaa, 0xbb);

const key = b(4, 1, 0, 0, 0, 0, 0, 0x61);
const pointer = b(5, 1, 0, 10, 0, 20);
const extendedPointer = b(5, 0x81, 0, 10, 0, 20, 1);
const cutText = Buffer.concat([b(6, 0, 0, 0, 0, 0, 0, 3), Buffer.from("abc")]);
const extendedCut = Buffer.concat([b(6, 0, 0, 0, 0xff, 0xff, 0xff, 0xfc), b(1, 2, 3, 4)]);
const xvp = b(250, 0, 1, 2);
const desktopSize = Buffer.concat([b(251, 0, 4, 0, 3, 0, 1, 0), Buffer.alloc(16)]);
const qemuKey = Buffer.concat([b(255, 0, 0, 1), Buffer.alloc(8)]);

describe("createRfbViewOnlyFilter", () => {
  it("forwards the handshake and picture requests and drops every input", () => {
    const filter = createRfbViewOnlyFilter();
    const sent = Buffer.concat([
      HANDSHAKE,
      setPixelFormat,
      key,
      setEncodings,
      pointer,
      extendedPointer,
      updateRequest,
      cutText,
      extendedCut,
      continuous,
      xvp,
      desktopSize,
      qemuKey,
      fence,
    ]);
    expect(filter.push(sent)).toEqual(
      Buffer.concat([HANDSHAKE, setPixelFormat, setEncodings, updateRequest, continuous, fence]),
    );
  });

  it("frames messages split across chunks, byte by byte", () => {
    const filter = createRfbViewOnlyFilter();
    const sent = Buffer.concat([HANDSHAKE, key, updateRequest, cutText, setEncodings]);
    const out: Buffer[] = [];
    for (const byte of sent) out.push(filter.push(b(byte)));
    expect(Buffer.concat(out)).toEqual(Buffer.concat([HANDSHAKE, updateRequest, setEncodings]));
  });

  it("skips the security byte on RFB 3.3, where the server picks", () => {
    const filter = createRfbViewOnlyFilter();
    const sent = Buffer.concat([Buffer.from("RFB 003.003\n"), b(1), key, updateRequest]);
    expect(filter.push(sent)).toEqual(
      Buffer.concat([Buffer.from("RFB 003.003\n"), b(1), updateRequest]),
    );
  });

  it("fails on a security type other than None, a bad version, or an unknown message", () => {
    expect(() =>
      createRfbViewOnlyFilter().push(Buffer.concat([Buffer.from("RFB 003.008\n"), b(2)])),
    ).toThrow(RfbViewOnlyError);
    expect(() => createRfbViewOnlyFilter().push(Buffer.from("GET / HTTP/1.1\r\n"))).toThrow(
      RfbViewOnlyError,
    );
    expect(() => createRfbViewOnlyFilter().push(Buffer.concat([HANDSHAKE, b(99)]))).toThrow(
      RfbViewOnlyError,
    );
    expect(() => createRfbViewOnlyFilter().push(Buffer.concat([HANDSHAKE, b(255, 1)]))).toThrow(
      RfbViewOnlyError,
    );
  });

  it("refuses a clipboard message that claims more than the relay cap", () => {
    const filter = createRfbViewOnlyFilter();
    filter.push(HANDSHAKE);
    const header = Buffer.alloc(8);
    header[0] = 6;
    header.writeUInt32BE(0x7f_ff_ff_f0, 4);
    expect(() => filter.push(header)).toThrow(RfbViewOnlyError);
  });

  it("still frames a large clipboard that stays under the cap, in pieces", () => {
    const filter = createRfbViewOnlyFilter();
    filter.push(HANDSHAKE);
    const length = 1_000_000;
    const message = Buffer.alloc(8 + length, 0x41);
    message[0] = 6;
    message.writeUInt32BE(length, 4);
    const out: Buffer[] = [];
    for (let at = 0; at < message.length; at += 64 * 1024) {
      out.push(filter.push(message.subarray(at, at + 64 * 1024)));
    }
    expect(Buffer.concat(out).length).toBe(0);
  });
});

describe("createRfbInputWatch", () => {
  it("counts the owner's key and pointer messages, not picture requests", () => {
    let inputs = 0;
    const watch = createRfbInputWatch(() => (inputs += 1));
    watch.push(Buffer.concat([HANDSHAKE, setPixelFormat, setEncodings, updateRequest]));
    expect(inputs).toBe(0);
    watch.push(Buffer.concat([updateRequest, pointer.subarray(0, 3)]));
    expect(inputs).toBe(0);
    watch.push(Buffer.concat([pointer.subarray(3), key]));
    expect(inputs).toBe(2);
  });

  it("counts every chunk as input once it cannot frame one", () => {
    let inputs = 0;
    const watch = createRfbInputWatch(() => (inputs += 1));
    watch.push(Buffer.concat([HANDSHAKE, b(99)]));
    expect(inputs).toBe(1);
    watch.push(updateRequest);
    expect(inputs).toBe(2);
  });
});
