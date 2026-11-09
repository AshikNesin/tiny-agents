/**
 * The agent's views of uploads. An id is valid only for sends into that
 * conversation (issue #17), so a bot cannot reach into another chat's files:
 *
 * - VisionStore: see_image resolves upload ids to prepared image bytes.
 * - AttachmentStore (issue #58): the attachments toolkit lists, reads and
 *   copies files through their stored extraction.
 */
import { eq, inArray } from "drizzle-orm";
import { storageService } from "@groot/core/storage";
import type {
  AttachmentStatus,
  AttachmentStore,
  AttachmentSummary,
  VisionStore,
} from "@tiny-agents/agent";
import { db, uploads, type Upload } from "../../db";
import { extractionMachine } from "../../../shared/machines/extraction";
import { ensureExtracting, loadContent } from "./uploads.extraction";
import { asBuffer, sniffImage } from "./uploads.prepare";

/** Model-ready variant bytes for see_image and inline sends. */
export async function modelImage(
  id: string,
): Promise<
  { data: string; mimeType: string; name: string; width?: number; height?: number } | undefined
> {
  const row = await db.query.uploads.findFirst({ where: eq(uploads.id, id) });
  if (!row || row.kind !== "image" || !row.modelKey) return undefined;
  const file = await storageService.downloadFile({ filePath: row.modelKey });
  const bytes = asBuffer(file.bytes);
  return {
    data: bytes.toString("base64"),
    // The variant's own bytes decide: local storage types objects by key
    // extension, and `chat/<id>/model` has none.
    mimeType: sniffImage(bytes) ?? (file.contentType || row.mimeType),
    name: row.name,
    ...(row.width !== null && row.height !== null ? { width: row.width, height: row.height } : {}),
  };
}

type IdSource = { attachmentIds(conversationId: number): Promise<string[]> };

export function createVisionStore(rt: IdSource): VisionStore {
  return {
    image: async (conversationId, uploadId) => {
      const ids = await rt.attachmentIds(conversationId);
      if (!ids.includes(uploadId)) return undefined;
      return modelImage(uploadId);
    },
  };
}

type UploadRow = Upload;

export function summarize(row: UploadRow): AttachmentSummary {
  let meta: Record<string, unknown> = {};
  try {
    meta = row.extractMeta ? (JSON.parse(row.extractMeta) as Record<string, unknown>) : {};
  } catch {
    meta = {};
  }
  const count = (key: string) =>
    typeof meta[key] === "number" ? (meta[key] as number) : undefined;
  const status: AttachmentStatus = extractionMachine.is(row.extractStatus)
    ? row.extractStatus
    : "none";
  const pages = count("pages");
  const sheets = count("sheets");
  const lines = count("lines");
  const entries = count("entries");
  return {
    uploadId: row.id,
    name: row.name,
    mimeType: row.mimeType,
    size: row.size,
    kind: row.kind === "image" ? "image" : "file",
    status,
    ...(row.extractError ? { error: row.extractError } : {}),
    ...(pages !== undefined ? { pages } : {}),
    ...(sheets !== undefined ? { sheets } : {}),
    ...(lines !== undefined ? { lines } : {}),
    ...(entries !== undefined ? { entries } : {}),
    ...(meta.truncated === true ? { truncated: true } : {}),
  };
}

export function createAttachmentStore(rt: IdSource): AttachmentStore {
  const scoped = async (conversationId: number, uploadId: string) => {
    const ids = await rt.attachmentIds(conversationId);
    if (!ids.includes(uploadId)) return undefined;
    const row = await db.query.uploads.findFirst({ where: eq(uploads.id, uploadId) });
    return row ? ensureExtracting(row) : undefined;
  };
  return {
    async list(conversationId) {
      const ids = await rt.attachmentIds(conversationId);
      if (ids.length === 0) return [];
      const rows = await db.select().from(uploads).where(inArray(uploads.id, ids));
      const byId = new Map(rows.map((row) => [row.id, row]));
      const out: AttachmentSummary[] = [];
      for (const id of ids) {
        const row = byId.get(id);
        if (row) out.push(summarize(await ensureExtracting(row)));
      }
      return out;
    },
    async open(conversationId, uploadId) {
      const row = await scoped(conversationId, uploadId);
      if (!row) return undefined;
      const summary = summarize(row);
      if (summary.status !== "ready") return { summary };
      const content = await loadContent(row.id);
      return content
        ? { summary, content }
        : { summary: { ...summary, status: "failed", error: "The extracted text is missing." } };
    },
    async original(conversationId, uploadId) {
      const row = await scoped(conversationId, uploadId);
      if (!row) return undefined;
      const file = await storageService.downloadFile({ filePath: row.storageKey });
      return { name: row.name, bytes: new Uint8Array(file.bytes) };
    },
  };
}
