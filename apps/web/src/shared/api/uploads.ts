import type { AttachmentContent, AttachmentEntry, AttachmentRef } from "@tiny-agents/agent";
import type { ExtractStatus } from "../machines/extraction";

export interface StoredUpload {
  ref: AttachmentRef;
}

export interface UploadMeta {
  format: Format;
  pages?: number;
  sheets?: number;
  lines?: number;
  entries?: number;
  chars: number;
  truncated?: boolean;
  title?: string;
  author?: string;
  valid?: boolean;
  imagePages?: number;
  suspicious?: string;
}

export interface UploadStatus {
  ref: AttachmentRef;
  status: ExtractStatus;
  error?: string;
  meta?: UploadMeta;
}

type Format = AttachmentContent["format"];

export type UploadText =
  | { status: "ready"; format: Format; page: number; pages: number; label: string; text: string }
  | {
      status: "ready";
      format: Format;
      sheets: { name: string; hidden: boolean }[];
      sheet: number;
      rows: string[][];
      totalRows: number;
    }
  | { status: "ready"; format: Format; entries: AttachmentEntry[] }
  | { status: Exclude<ExtractStatus, "ready">; error?: string };
