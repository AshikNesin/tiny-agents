/** The Uploads API's wire types (`server/api/uploads`, issues #17, #58); naming in `./common.ts`. */
import type { AttachmentContent, AttachmentEntry, AttachmentRef } from "@tiny-agents/agent";
import type { ExtractStatus } from "../machines/extraction";

/** `POST /uploads`: the stored file's reference, what a message attaches. */
export interface StoredUpload {
  ref: AttachmentRef;
}

/** What extraction recorded about a file (`uploads.extract.ts`), stored as JSON. */
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
  /** JSON/YAML: whether it parses. */
  valid?: boolean;
  /** PDF pages with almost no text (scans, images). */
  imagePages?: number;
  suspicious?: string;
}

/** `GET /uploads/:id`: an upload's live extraction state. */
export interface UploadStatus {
  ref: AttachmentRef;
  status: ExtractStatus;
  error?: string;
  meta?: UploadMeta;
}

type Format = AttachmentContent["format"];

/** `GET /uploads/:id/text`: one page, sheet or archive listing of extracted text. */
export type UploadText =
  | { status: "ready"; format: Format; page: number; pages: number; label: string; text: string }
  | {
      status: "ready";
      format: Format;
      sheets: { name: string; hidden: boolean }[];
      /** 1-based. */
      sheet: number;
      /** Up to 200 rows, header first. */
      rows: string[][];
      totalRows: number;
    }
  | { status: "ready"; format: Format; entries: AttachmentEntry[] }
  | { status: Exclude<ExtractStatus, "ready">; error?: string };
