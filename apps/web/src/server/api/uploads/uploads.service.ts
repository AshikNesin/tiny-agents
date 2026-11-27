import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { storageService } from "@groot/core/storage";
import type { AttachmentRef } from "@tiny-agents/agent";
import { db, uploads } from "../../db";
import type { ExtractStatus } from "../../../shared/machines/extraction";
import { asBuffer, imageSize, prepareImage, sniffImage } from "./uploads.prepare";
import {
  cancelExtraction,
  ensureExtracting,
  extractKey,
  forgetContent,
  initialExtraction,
  startExtraction,
} from "./uploads.extraction";
import { extensionOf, sniffFile, SniffError, TEXT_EXTENSIONS } from "./uploads.sniff";
import type { StoredUpload, UploadMeta, UploadStatus } from "../../../shared/api/uploads";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "pdf",
  "txt",
  "md",
  "json",
  "csv",
  "yaml",
  "yml",
  "xml",
  "html",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "odt",
  "ods",
  "odp",
  "zip",
  "tar",
  "gz",
  "tgz",
  "bz2",
  "7z",
  "rar",
  "mp3",
  "wav",
  "ogg",
  "m4a",
  "mp4",
  "webm",
  "mov",
  "tsv",
  ...TEXT_EXTENSIONS,
]);

function sanitizeName(name: string): string {
  // oxlint-disable-next-line no-control-regex
  const trimmed = name.replace(/[\r\n"\\/\x00-\x1f]/g, "_").trim();
  return trimmed.slice(0, 200) || "file";
}

function checkExtension(name: string): void {
  const ext = extensionOf(name);
  if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
    throw Boom.badRequest(
      `Files of type ".${ext || "?"}" are not supported. Images, documents, text and code, archives and media are.`,
    );
  }
}

export async function createUpload(
  input: { name: string; mimeType: string; bytes: Buffer; uploadedBy: number },
  prepare: { image: typeof prepareImage } = { image: prepareImage },
): Promise<StoredUpload> {
  const name = sanitizeName(input.name);
  checkExtension(name);
  const sniffed = sniffImage(input.bytes);
  const isImage = Boolean(sniffed);
  if (isImage && input.bytes.length > MAX_IMAGE_BYTES) {
    throw Boom.badRequest("Images are limited to 20 MB.");
  }
  if (!isImage && input.bytes.length > MAX_FILE_BYTES) {
    throw Boom.badRequest("Files are limited to 25 MB.");
  }
  const claimsImage = ["png", "jpg", "jpeg", "webp", "gif"].includes(extensionOf(name));
  if (claimsImage !== isImage) {
    throw Boom.badRequest(
      claimsImage
        ? "This file's contents are not a supported image."
        : "This looks like an image; save it with an image extension (.png, .jpg, .webp, .gif).",
    );
  }

  let sniffedFile: ReturnType<typeof sniffFile> | undefined;
  if (!isImage) {
    try {
      sniffedFile = sniffFile(input.bytes, extensionOf(name));
    } catch (error) {
      if (error instanceof SniffError) throw Boom.unsupportedMediaType(error.message);
      throw error;
    }
  }

  const uploadId = createHash("sha256")
    .update(
      `${name}:${input.mimeType}:${createHash("sha1").update(input.bytes).digest("hex")}:${Date.now()}:${Math.random()}`,
    )
    .digest("hex")
    .slice(0, 24);
  const originalKey = `chat/${uploadId}/original`;
  let modelKey: string | null = null;
  const size = imageSize(input.bytes, sniffed!);
  const width = size?.width;
  const height = size?.height;

  await storageService.uploadFile({
    filePath: originalKey,
    fileData: input.bytes,
    contentType: input.mimeType,
  });
  if (isImage) {
    const prepared = await prepare.image(input.bytes, sniffed!);
    if (!prepared)
      throw Boom.badRequest("This image could not be decoded (corrupt or unsupported).");
    modelKey = `chat/${uploadId}/model`;
    await storageService.uploadFile({
      filePath: modelKey,
      fileData: Buffer.from(prepared.data, "base64"),
      contentType: prepared.mimeType,
    });
  }

  const [row] = await db
    .insert(uploads)
    .values({
      id: uploadId,
      kind: isImage ? "image" : "file",
      name,
      mimeType: sniffed ?? sniffedFile?.mime ?? input.mimeType,
      size: input.bytes.length,
      ...(width !== undefined && height !== undefined ? { width, height } : {}),
      modelKey,
      storageKey: originalKey,
      uploadedBy: input.uploadedBy,
      sha256: createHash("sha256").update(input.bytes).digest("hex"),
      ...(await initialExtraction(sniffedFile, name)),
    })
    .returning();
  startExtraction(row!, sniffedFile?.kind);
  return { ref: toRef(row!) };
}

function toRef(row: {
  id: string;
  kind: string;
  name: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  extractStatus?: ExtractStatus;
}): AttachmentRef {
  return {
    uploadId: row.id,
    kind: row.kind === "image" ? "image" : "file",
    name: row.name,
    mimeType: row.mimeType,
    size: row.size,
    ...(row.width !== null && row.height !== null ? { width: row.width, height: row.height } : {}),
    ...(row.kind === "file" && row.extractStatus ? { status: row.extractStatus } : {}),
  };
}

export async function uploadStatus(id: string): Promise<UploadStatus> {
  const found = await findUpload(id);
  if (!found) throw Boom.notFound("Unknown upload");
  const row = await ensureExtracting(found);
  return {
    ref: toRef(row),
    status: row.extractStatus,
    ...(row.extractError ? { error: row.extractError } : {}),
    ...(row.extractMeta ? { meta: JSON.parse(row.extractMeta) as UploadMeta } : {}),
  };
}

async function getUpload(id: string): Promise<AttachmentRef> {
  const row = await findUpload(id);
  if (!row) throw Boom.notFound("Unknown upload");
  return toRef(row);
}

function findUpload(id: string) {
  return db.query.uploads.findFirst({ where: eq(uploads.id, id) });
}

export async function sentInBot(ids: string[], botId: string): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(uploads)
    .set({ botId })
    .where(and(inArray(uploads.id, ids), isNull(uploads.botId)));
}

export async function originalBytes(
  id: string,
): Promise<{ bytes: Buffer<ArrayBuffer>; ref: AttachmentRef }> {
  const ref = await getUpload(id);
  const file = await storageService.downloadFile({ filePath: `chat/${id}/original` });
  return { bytes: asBuffer(file.bytes), ref };
}

export async function deleteUpload(id: string): Promise<void> {
  const row = await findUpload(id);
  if (!row) throw Boom.notFound("Unknown upload");
  cancelExtraction(id);
  const keys = [
    row.storageKey,
    ...(row.modelKey ? [row.modelKey] : []),
    ...(row.kind === "file" ? [extractKey(id)] : []),
  ];
  await storageService.deleteFiles({ filePaths: keys });
  await db.delete(uploads).where(eq(uploads.id, id));
  forgetContent(id);
}
