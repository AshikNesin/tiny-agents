/**
 * Upload service (issue #17): validate, prepare and store chat attachments.
 *
 * One row per attachment is the single validated metadata source; bytes live
 * in files storage under chat/<uploadId>/{original,model,extract.json}.
 * Images get a model-ready variant (EXIF-upright, resized, base64-bounded)
 * prepared at upload time so the send click never waits on Photon. Every
 * other file is sniffed (issue #58: the stored MIME is what the bytes are)
 * and queued for background extraction.
 */
import { createHash } from "node:crypto";
import { Boom } from "@groot/core/errors";
import { storageService } from "@groot/core/storage";
import { prisma } from "@groot/core/database";
import type { AttachmentRef } from "@tiny-agents/agent";
import { imageSize, prepareImage, sniffImage } from "./uploads.prepare";
import { extract } from "./uploads.extract";
import { extractKey, forgetContent, queueExtraction } from "./uploads.extraction";
import { sniffFile, SniffError, TEXT_EXTENSIONS } from "./uploads.sniff";

/** Max original sizes (issue #17 limits table). */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Max attachments on one send. */
export const MAX_ATTACHMENTS = 10;

/** Extensions a chat attachment may carry (denylist: executables, scripts). */
const ALLOWED_EXTENSIONS = new Set([
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
  // Code and plain text (issue #58): stored and read as text, never run.
  ...TEXT_EXTENSIONS,
]);

export interface StoredUpload {
  ref: AttachmentRef;
}

function sanitizeName(name: string): string {
  const trimmed = name.replace(/[\r\n"\\/\x00-\x1f]/g, "_").trim();
  return trimmed.slice(0, 200) || "file";
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/** Reject executables/scripts and unknown extensions at the boundary. */
function checkExtension(name: string): void {
  const ext = extensionOf(name);
  if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
    throw Boom.badRequest(
      `Files of type ".${ext || "?"}" are not supported. Images, documents, text and code, archives and media are.`,
    );
  }
}

export async function createUpload(
  input: { name: string; mimeType: string; bytes: Buffer },
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
  // A name claiming image but bytes disagreeing (or the reverse) is rejected:
  // the model path and the UI must agree on what this is.
  const claimsImage = ["png", "jpg", "jpeg", "webp", "gif"].includes(extensionOf(name));
  if (claimsImage !== isImage) {
    throw Boom.badRequest(
      claimsImage
        ? "This file's contents are not a supported image."
        : "This looks like an image; save it with an image extension (.png, .jpg, .webp, .gif).",
    );
  }

  // Non-images: the bytes must be what the name says (and never a binary).
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
  // Dimensions come from the original bytes: Photon reports them only when
  // it resized, and the UI shows the owner's image, not the variant.
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

  // Types we can't read are settled now; the rest extract in the background.
  const unreadable =
    sniffedFile?.kind === "unsupported"
      ? await extract({ bytes: new Uint8Array(), kind: "unsupported", name }, sniffedFile.mime)
      : undefined;
  const row = await prisma.upload.create({
    data: {
      id: uploadId,
      kind: isImage ? "image" : "file",
      name,
      mimeType: sniffed ?? sniffedFile?.mime ?? input.mimeType,
      size: input.bytes.length,
      ...(width !== undefined && height !== undefined ? { width, height } : {}),
      modelKey,
      storageKey: originalKey,
      sha256: createHash("sha256").update(input.bytes).digest("hex"),
      ...(isImage
        ? {}
        : unreadable && unreadable.status !== "ready"
          ? {
              extractStatus: unreadable.status,
              extractError: unreadable.error,
              extractedAt: new Date(),
            }
          : { extractStatus: "pending" }),
    },
  });
  if (row.extractStatus === "pending") queueExtraction(row.id);
  return { ref: toRef(row) };
}

function toRef(row: {
  id: string;
  kind: string;
  name: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  extractStatus?: string;
}): AttachmentRef {
  return {
    uploadId: row.id,
    kind: row.kind === "image" ? "image" : "file",
    name: row.name,
    mimeType: row.mimeType,
    size: row.size,
    ...(row.width !== null && row.height !== null ? { width: row.width, height: row.height } : {}),
    ...(row.kind === "file" && row.extractStatus
      ? { status: row.extractStatus as NonNullable<AttachmentRef["status"]> }
      : {}),
  };
}

/** An upload's live extraction state, for chips and the preview drawer. */
export async function uploadStatus(id: string) {
  const row = await prisma.upload.findUnique({ where: { id } });
  if (!row) throw Boom.notFound("Unknown upload");
  // Uploads from before extraction existed are read on first request.
  if (row.kind === "file" && row.extractStatus === "none") {
    await prisma.upload.update({ where: { id }, data: { extractStatus: "pending" } });
    queueExtraction(id);
    row.extractStatus = "pending";
  }
  return {
    ref: toRef(row),
    status: row.extractStatus,
    ...(row.extractError ? { error: row.extractError } : {}),
    ...(row.extractMeta ? { meta: JSON.parse(row.extractMeta) as Record<string, unknown> } : {}),
  };
}

export async function getUpload(id: string): Promise<AttachmentRef> {
  const row = await prisma.upload.findUnique({ where: { id } });
  if (!row) throw Boom.notFound("Unknown upload");
  return toRef(row);
}

/** Original bytes for the UI/download endpoint. */
export async function originalBytes(id: string): Promise<{ bytes: Buffer; ref: AttachmentRef }> {
  const ref = await getUpload(id);
  const file = await storageService.downloadFile({ filePath: `chat/${id}/original` });
  return { bytes: file.buffer, ref };
}

/** Model-ready variant bytes for see_image and inline sends. */
export async function modelImage(
  id: string,
): Promise<
  { data: string; mimeType: string; name: string; width?: number; height?: number } | undefined
> {
  const row = await prisma.upload.findUnique({ where: { id } });
  if (!row || row.kind !== "image" || !row.modelKey) return undefined;
  const file = await storageService.downloadFile({ filePath: row.modelKey });
  return {
    data: file.buffer.toString("base64"),
    mimeType: file.contentType || row.mimeType,
    name: row.name,
    ...(row.width !== null && row.height !== null ? { width: row.width, height: row.height } : {}),
  };
}

/** Delete an upload: the row, the original and every derived artifact. */
export async function deleteUpload(id: string): Promise<void> {
  const row = await prisma.upload.findUnique({ where: { id } });
  if (!row) throw Boom.notFound("Unknown upload");
  await prisma.upload.delete({ where: { id } });
  forgetContent(id);
  const keys = [
    row.storageKey,
    ...(row.modelKey ? [row.modelKey] : []),
    ...(row.kind === "file" ? [extractKey(id)] : []),
  ];
  try {
    await storageService.deleteFiles({ filePaths: keys });
  } catch {
    // The row is gone; leftover bytes are sweepable. Never block the delete.
  }
}
