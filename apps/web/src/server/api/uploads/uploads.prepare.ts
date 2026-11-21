import {
  createNodePhotonImages,
  type PreparedImage,
  type ImageProcessor,
} from "@tiny-agents/agent";

let processor: Promise<ImageProcessor> | undefined;

function images(): Promise<ImageProcessor> {
  return (processor ??= createNodePhotonImages());
}

export function sniffImage(bytes: Buffer): string | undefined {
  if (bytes.length >= 12 && bytes.readUInt32BE(0) === 0x89504e47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.subarray(0, 6).toString("latin1") === "GIF87a" ||
    bytes.subarray(0, 6).toString("latin1") === "GIF89a"
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  return undefined;
}

export interface PreparedForModel {
  data: string;
  mimeType: string;
  width: number;
  height: number;
}

export async function prepareImage(
  bytes: Buffer,
  mimeType: string,
): Promise<PreparedForModel | undefined> {
  const { DEFAULT_IMAGE_LIMITS } = await import("@tiny-agents/agent");
  const plain = new Uint8Array(bytes.byteLength);
  plain.set(bytes);
  const prepared: PreparedImage | undefined = await (
    await images()
  ).prepare(plain, mimeType, DEFAULT_IMAGE_LIMITS);
  if (!prepared) return undefined;
  return {
    data: prepared.data,
    mimeType: prepared.mimeType,
    width: prepared.resized?.to.width ?? 0,
    height: prepared.resized?.to.height ?? 0,
  };
}

export function imageSize(
  bytes: Buffer,
  mimeType: string,
): { width: number; height: number } | undefined {
  if (mimeType === "image/png" && bytes.length >= 24) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (mimeType === "image/gif" && bytes.length >= 10) {
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  }
  if (mimeType === "image/jpeg") {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      const length = bytes.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
    return undefined;
  }
  if (mimeType === "image/webp" && bytes.length >= 30) {
    const format = bytes.subarray(12, 16).toString("latin1");
    if (format === "VP8X") {
      const width = 1 + ((bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) & 0xffffff);
      const height = 1 + ((bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) & 0xffffff);
      return { width, height };
    }
    if (format === "VP8 " && bytes.length >= 26) {
      return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    }
    if (format === "VP8L" && bytes.length >= 21) {
      const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  return undefined;
}

export function asBuffer(bytes: Uint8Array<ArrayBuffer>): Buffer<ArrayBuffer> {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
