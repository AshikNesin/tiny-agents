/**
 * Archive listings (issue #58 §9.4): the app server lists archives and never
 * extracts them. Zip entries come from the central directory; tar headers
 * are walked (through gunzip for .tgz, stopping at the caps) while file data
 * is skipped. Unsafe paths and extreme compression ratios are flagged, and a
 * listing past the caps is marked suspicious instead of being expanded.
 */
import { createGunzip } from "node:zlib";
import { unzipSync } from "fflate";
import type { AttachmentEntry } from "@tiny-agents/agent";

export interface ArchiveLimits {
  maxEntries: number;
  /** Total declared (uncompressed) size. */
  maxTotalBytes: number;
  /** Per-entry declared/compressed ratio above which an entry is flagged. */
  maxRatio: number;
}

export interface ArchiveListing {
  entries: AttachmentEntry[];
  truncated: boolean;
  /** Why the archive as a whole looks hostile (it is still only listed). */
  suspicious?: string;
}

const NESTED = /\.(zip|tar|tgz|gz|bz2|7z|rar|jar)$/i;

/** Path traversal, absolute paths and control characters. */
export function pathFlag(path: string): string | undefined {
  // oxlint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) return "control characters in the name";
  if (path.startsWith("/") || /^[a-z]:[\\/]/i.test(path)) return "absolute path";
  if (path.split(/[\\/]/).includes("..")) return "path escapes the archive (..)";
  return undefined;
}

function flagEntry(entry: AttachmentEntry, limits: ArchiveLimits): AttachmentEntry {
  const flags = [pathFlag(entry.path)];
  if (
    entry.compressedSize !== undefined &&
    entry.size > 1024 * 1024 &&
    entry.size / Math.max(1, entry.compressedSize) > limits.maxRatio
  ) {
    flags.push(`compression ratio over ${limits.maxRatio}:1`);
  }
  if (NESTED.test(entry.path)) flags.push("nested archive (listed by name only)");
  const flag = flags.filter(Boolean).join("; ");
  return flag ? { ...entry, flag } : entry;
}

export function listZip(bytes: Uint8Array, limits: ArchiveLimits): ArchiveListing {
  const entries: AttachmentEntry[] = [];
  let total = 0;
  let count = 0;
  unzipSync(bytes, {
    filter: (file) => {
      count += 1;
      total += file.originalSize;
      if (entries.length < limits.maxEntries) {
        const dir = file.name.endsWith("/");
        entries.push(
          flagEntry(
            {
              path: dir ? file.name.slice(0, -1) : file.name,
              size: file.originalSize,
              compressedSize: file.size,
              ...(dir ? { dir: true } : {}),
            },
            limits,
          ),
        );
      }
      return false;
    },
  });
  return {
    entries,
    truncated: count > entries.length,
    ...(total > limits.maxTotalBytes
      ? { suspicious: `declares ${Math.round(total / 1024 / 1024)} MB uncompressed` }
      : {}),
  };
}

const cstring = (block: Uint8Array, offset: number, length: number) => {
  const slice = block.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return new TextDecoder().decode(end === -1 ? slice : slice.subarray(0, end));
};

function octal(block: Uint8Array, offset: number, length: number): number {
  // GNU base-256 for sizes over 8 GB: the high bit is set.
  if (block[offset] & 0x80) {
    let value = 0;
    for (let i = offset + 1; i < offset + length; i++) value = value * 256 + block[i];
    return value;
  }
  const text = cstring(block, offset, length).trim();
  return text ? parseInt(text, 8) || 0 : 0;
}

/** A streaming tar header walker: file data is counted and skipped. */
export class TarLister {
  readonly entries: AttachmentEntry[] = [];
  truncated = false;
  suspicious: string | undefined;
  done = false;
  #limits: ArchiveLimits;
  #header = new Uint8Array(512);
  #filled = 0;
  #skip = 0;
  #total = 0;
  #zeroBlocks = 0;
  /** Collecting a GNU long name ('L') or pax header ('x') body. */
  #collect: { kind: "L" | "x"; size: number; chunks: Uint8Array[]; got: number } | undefined;
  #longName: string | undefined;

  constructor(limits: ArchiveLimits) {
    this.#limits = limits;
  }

  push(chunk: Uint8Array): void {
    let offset = 0;
    while (offset < chunk.length && !this.done) {
      if (this.#skip > 0) {
        const take = Math.min(this.#skip, chunk.length - offset);
        if (this.#collect && this.#collect.got < this.#collect.size) {
          const want = Math.min(take, this.#collect.size - this.#collect.got, 65_536);
          this.#collect.chunks.push(chunk.slice(offset, offset + want));
          this.#collect.got += want;
        }
        this.#skip -= take;
        offset += take;
        if (this.#skip === 0 && this.#collect) this.#finishCollect();
        continue;
      }
      const take = Math.min(512 - this.#filled, chunk.length - offset);
      this.#header.set(chunk.subarray(offset, offset + take), this.#filled);
      this.#filled += take;
      offset += take;
      if (this.#filled === 512) {
        this.#filled = 0;
        this.#onHeader(this.#header);
      }
    }
  }

  #finishCollect(): void {
    const collect = this.#collect!;
    this.#collect = undefined;
    const body = new TextDecoder().decode(Buffer.concat(collect.chunks)).replace(/\0+$/, "");
    if (collect.kind === "L") this.#longName = body;
    else {
      const path = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body);
      if (path) this.#longName = path[1];
    }
  }

  #onHeader(block: Uint8Array): void {
    if (block.every((byte) => byte === 0)) {
      this.#zeroBlocks += 1;
      if (this.#zeroBlocks >= 2) this.done = true;
      return;
    }
    this.#zeroBlocks = 0;
    const name = cstring(block, 0, 100);
    const size = octal(block, 124, 12);
    const type = String.fromCharCode(block[156] || 0x30);
    const magic = cstring(block, 257, 6);
    const prefix = magic.startsWith("ustar") ? cstring(block, 345, 155) : "";
    this.#skip = Math.ceil(size / 512) * 512;
    if (type === "L" || type === "x") {
      this.#collect = { kind: type, size, chunks: [], got: 0 };
      if (this.#skip === 0) this.#finishCollect();
      return;
    }
    if (type === "g") return;
    const path = (this.#longName ?? (prefix ? `${prefix}/${name}` : name)).replace(/\/$/, "");
    this.#longName = undefined;
    this.#total += size;
    if (this.entries.length >= this.#limits.maxEntries) {
      this.truncated = true;
      this.done = true;
      return;
    }
    this.entries.push(
      flagEntry({ path, size, ...(type === "5" ? { dir: true } : {}) }, this.#limits),
    );
    if (this.#total > this.#limits.maxTotalBytes) {
      this.suspicious = `holds over ${Math.round(this.#limits.maxTotalBytes / 1024 / 1024)} MB`;
      this.truncated = true;
      this.done = true;
    }
  }
}

export function listTar(bytes: Uint8Array, limits: ArchiveLimits): ArchiveListing {
  const lister = new TarLister(limits);
  lister.push(bytes);
  return {
    entries: lister.entries,
    truncated: lister.truncated,
    ...(lister.suspicious ? { suspicious: lister.suspicious } : {}),
  };
}

/** Gunzip only as far as the listing needs; stop at the caps. */
export async function listTgz(bytes: Uint8Array, limits: ArchiveLimits): Promise<ArchiveListing> {
  const lister = new TarLister(limits);
  const gunzip = createGunzip();
  let inflated = 0;
  let suspicious: string | undefined;
  gunzip.end(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  try {
    for await (const chunk of gunzip) {
      const data = chunk as Buffer;
      inflated += data.length;
      lister.push(data);
      if (lister.done) break;
      if (inflated > limits.maxTotalBytes) {
        suspicious = `expands past ${Math.round(limits.maxTotalBytes / 1024 / 1024)} MB`;
        break;
      }
    }
  } finally {
    gunzip.destroy();
  }
  const why = lister.suspicious ?? suspicious;
  return {
    entries: lister.entries,
    truncated: lister.truncated || Boolean(suspicious),
    ...(why ? { suspicious: why } : {}),
  };
}

/**
 * A plain .gz holds one file: its name (when the header has one) and the
 * declared size from the trailer. Nothing is inflated.
 */
export function listGzip(bytes: Uint8Array, fallbackName: string): ArchiveListing {
  const flags = bytes[3] ?? 0;
  let offset = 10;
  if (flags & 0x04) offset += 2 + (bytes[offset] | (bytes[offset + 1] << 8));
  let name = fallbackName.replace(/\.gz$/i, "");
  if (flags & 0x08) {
    const end = bytes.indexOf(0, offset);
    if (end > offset) name = new TextDecoder("latin1").decode(bytes.subarray(offset, end));
  }
  const n = bytes.length;
  // ISIZE is the size modulo 2^32.
  const size =
    n >= 4
      ? (bytes[n - 4] | (bytes[n - 3] << 8) | (bytes[n - 2] << 16) | (bytes[n - 1] << 24)) >>> 0
      : 0;
  const flag = pathFlag(name);
  return {
    entries: [{ path: name, size, compressedSize: n, ...(flag ? { flag } : {}) }],
    truncated: false,
  };
}
