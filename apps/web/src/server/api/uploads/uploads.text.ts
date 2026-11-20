export type ExtractKind =
  | "text"
  | "csv"
  | "html"
  | "json"
  | "yaml"
  | "pdf"
  | "docx"
  | "xlsx"
  | "pptx"
  | "odt"
  | "ods"
  | "odp"
  | "zip"
  | "tar"
  | "tgz"
  | "gz"
  | "unsupported";

export const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  bytes.length >= offset + signature.length &&
  signature.every((byte, index) => bytes[offset + index] === byte);

export function decodeText(bytes: Uint8Array): string {
  if (startsWith(bytes, [0xff, 0xfe])) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (startsWith(bytes, [0xfe, 0xff])) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}
