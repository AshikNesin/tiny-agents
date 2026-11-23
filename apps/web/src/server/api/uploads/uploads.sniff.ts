import { unzipSync } from "fflate";
import { sniffImage } from "./uploads.prepare";
import { startsWith, type ExtractKind } from "./uploads.text";

export { decodeText } from "./uploads.text";

export type { ExtractKind } from "./uploads.text";

export interface SniffResult {
  mime: string;
  kind: ExtractKind;
}

export class SniffError extends Error {}

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif"];

export const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "log",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "go",
  "rs",
  "java",
  "kt",
  "rb",
  "php",
  "sh",
  "sql",
  "toml",
  "ini",
  "cfg",
  "diff",
  "patch",
  "css",
  "c",
  "h",
  "cpp",
  "swift",
]);

const TEXT_MIME: Record<string, string> = {
  md: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  yaml: "application/yaml",
  yml: "application/yaml",
  xml: "application/xml",
  html: "text/html",
  diff: "text/x-diff",
  patch: "text/x-diff",
};

const OOXML: Record<string, { mime: string; part: string; kind: ExtractKind }> = {
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    part: "word/document.xml",
    kind: "docx",
  },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    part: "xl/workbook.xml",
    kind: "xlsx",
  },
  pptx: {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    part: "ppt/presentation.xml",
    kind: "pptx",
  },
};

const ODF: Record<string, { mime: string; kind: ExtractKind }> = {
  odt: { mime: "application/vnd.oasis.opendocument.text", kind: "odt" },
  ods: { mime: "application/vnd.oasis.opendocument.spreadsheet", kind: "ods" },
  odp: { mime: "application/vnd.oasis.opendocument.presentation", kind: "odp" },
};

const OLE: Record<string, string> = {
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
  ppt: "application/vnd.ms-powerpoint",
};

const ascii = (bytes: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + length));

function isPortableExecutable(bytes: Uint8Array): boolean {
  if (!startsWith(bytes, [0x4d, 0x5a]) || bytes.length < 0x40) return false;
  const offset =
    (bytes[0x3c] | (bytes[0x3d] << 8) | (bytes[0x3e] << 16) | (bytes[0x3f] << 24)) >>> 0;
  return offset > 0 && startsWith(bytes, [0x50, 0x45, 0x00, 0x00], offset);
}

function isExecutable(bytes: Uint8Array): boolean {
  return (
    startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46]) ||
    isPortableExecutable(bytes) ||
    startsWith(bytes, [0xfe, 0xed, 0xfa, 0xce]) ||
    startsWith(bytes, [0xfe, 0xed, 0xfa, 0xcf]) ||
    startsWith(bytes, [0xce, 0xfa, 0xed, 0xfe]) ||
    startsWith(bytes, [0xcf, 0xfa, 0xed, 0xfe]) ||
    startsWith(bytes, [0xca, 0xfe, 0xba, 0xbe])
  );
}

const isZip = (bytes: Uint8Array) =>
  startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]);

function zipEntryNames(bytes: Uint8Array): string[] {
  const names: string[] = [];
  try {
    unzipSync(bytes, {
      filter: (file) => {
        names.push(file.name);
        return false;
      },
    });
  } catch {}
  return names;
}

function looksLikeText(bytes: Uint8Array): boolean {
  if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])) return true;
  const head = bytes.subarray(0, 8192);
  return !head.includes(0);
}

function mediaMime(bytes: Uint8Array, ext: string): string | undefined {
  switch (ext) {
    case "mp3":
      return startsWith(bytes, [0x49, 0x44, 0x33]) ||
        (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
        ? "audio/mpeg"
        : undefined;
    case "wav":
      return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE"
        ? "audio/wav"
        : undefined;
    case "ogg":
      return ascii(bytes, 0, 4) === "OggS" ? "audio/ogg" : undefined;
    case "m4a":
      return ascii(bytes, 4, 4) === "ftyp" ? "audio/mp4" : undefined;
    case "mp4":
      return ascii(bytes, 4, 4) === "ftyp" ? "video/mp4" : undefined;
    case "mov":
      return ascii(bytes, 4, 4) === "ftyp" || ascii(bytes, 4, 4) === "moov"
        ? "video/quicktime"
        : undefined;
    case "webm":
      return startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]) ? "video/webm" : undefined;
    default:
      return undefined;
  }
}

const mismatch = (ext: string) =>
  new SniffError(`This file's contents don't match its .${ext} extension.`);

export function sniffFile(bytes: Uint8Array, ext: string): SniffResult {
  if (isExecutable(bytes)) {
    throw new SniffError("Executable files can't be attached.");
  }
  if (IMAGE_EXTENSIONS.includes(ext)) {
    const image = sniffImage(Buffer.from(bytes));
    if (!image) throw mismatch(ext);
    return { mime: image, kind: "unsupported" };
  }
  if (ext === "pdf") {
    const head = ascii(bytes, 0, Math.min(bytes.length, 1024));
    if (!head.includes("%PDF-")) throw mismatch(ext);
    return { mime: "application/pdf", kind: "pdf" };
  }
  if (ext in OOXML) {
    const { mime, part, kind } = OOXML[ext];
    if (!isZip(bytes) || !zipEntryNames(bytes).includes(part)) throw mismatch(ext);
    return { mime, kind };
  }
  if (ext in ODF) {
    const { mime, kind } = ODF[ext];
    if (!isZip(bytes) || !zipEntryNames(bytes).includes("content.xml")) throw mismatch(ext);
    return { mime, kind };
  }
  if (ext in OLE) {
    if (!startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) throw mismatch(ext);
    return { mime: OLE[ext], kind: "unsupported" };
  }
  switch (ext) {
    case "zip":
      if (!isZip(bytes)) throw mismatch(ext);
      return { mime: "application/zip", kind: "zip" };
    case "gz":
    case "tgz":
      if (!startsWith(bytes, [0x1f, 0x8b])) throw mismatch(ext);
      return { mime: "application/gzip", kind: ext === "tgz" ? "tgz" : "gz" };
    case "tar":
      if (ascii(bytes, 257, 5) !== "ustar") throw mismatch(ext);
      return { mime: "application/x-tar", kind: "tar" };
    case "bz2":
      if (ascii(bytes, 0, 3) !== "BZh") throw mismatch(ext);
      return { mime: "application/x-bzip2", kind: "unsupported" };
    case "7z":
      if (!startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) throw mismatch(ext);
      return { mime: "application/x-7z-compressed", kind: "unsupported" };
    case "rar":
      if (ascii(bytes, 0, 4) !== "Rar!") throw mismatch(ext);
      return { mime: "application/vnd.rar", kind: "unsupported" };
  }
  const media = ["mp3", "wav", "ogg", "m4a", "mp4", "mov", "webm"];
  if (media.includes(ext)) {
    const mime = mediaMime(bytes, ext);
    if (!mime) throw mismatch(ext);
    return { mime, kind: "unsupported" };
  }
  if (!looksLikeText(bytes)) throw mismatch(ext);
  const mime = TEXT_MIME[ext] ?? "text/plain";
  const kind: ExtractKind =
    ext === "csv" || ext === "tsv"
      ? "csv"
      : ext === "html"
        ? "html"
        : ext === "json"
          ? "json"
          : ext === "yaml" || ext === "yml"
            ? "yaml"
            : "text";
  return { mime, kind };
}
