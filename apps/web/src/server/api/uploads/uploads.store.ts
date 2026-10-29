/**
 * The agent's views of uploads. An id is valid only for sends into that
 * conversation (issue #17), so a bot cannot reach into another chat's files:
 *
 * - VisionStore: see_image resolves upload ids to prepared image bytes.
 * - AttachmentStore (issue #58): the attachments toolkit lists, reads and
 *   copies files through their stored extraction.
 */
import { prisma } from "@groot/core/database";
import { storageService } from "@groot/core/storage";
import type {
  AttachmentStatus,
  AttachmentStore,
  AttachmentSummary,
  VisionStore,
} from "@tiny-agents/agent";
import { loadContent, queueExtraction } from "./uploads.extraction";
import { modelImage } from "./uploads.service";

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

type UploadRow = NonNullable<Awaited<ReturnType<typeof prisma.upload.findUnique>>>;

const STATUSES = new Set<AttachmentStatus>(["none", "pending", "ready", "failed", "unsupported"]);

export function summarize(row: UploadRow): AttachmentSummary {
  let meta: Record<string, unknown> = {};
  try {
    meta = row.extractMeta ? (JSON.parse(row.extractMeta) as Record<string, unknown>) : {};
  } catch {
    meta = {};
  }
  const count = (key: string) =>
    typeof meta[key] === "number" ? (meta[key] as number) : undefined;
  const status = STATUSES.has(row.extractStatus as AttachmentStatus)
    ? (row.extractStatus as AttachmentStatus)
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

/** Uploads from before extraction existed are queued the first time a bot asks. */
async function ensureQueued(row: UploadRow): Promise<UploadRow> {
  if (row.kind !== "file" || row.extractStatus !== "none") return row;
  await prisma.upload.update({ where: { id: row.id }, data: { extractStatus: "pending" } });
  queueExtraction(row.id);
  return { ...row, extractStatus: "pending" };
}

export function createAttachmentStore(rt: IdSource): AttachmentStore {
  const scoped = async (conversationId: number, uploadId: string) => {
    const ids = await rt.attachmentIds(conversationId);
    if (!ids.includes(uploadId)) return undefined;
    const row = await prisma.upload.findUnique({ where: { id: uploadId } });
    return row ? ensureQueued(row) : undefined;
  };
  return {
    async list(conversationId) {
      const ids = await rt.attachmentIds(conversationId);
      if (ids.length === 0) return [];
      const rows = await prisma.upload.findMany({ where: { id: { in: ids } } });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const out: AttachmentSummary[] = [];
      for (const id of ids) {
        const row = byId.get(id);
        if (row) out.push(summarize(await ensureQueued(row)));
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
      return { name: row.name, bytes: new Uint8Array(file.buffer) };
    },
  };
}
