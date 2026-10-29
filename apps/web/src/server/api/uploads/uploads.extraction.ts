/**
 * Background extraction (issue #58): each new file upload is queued, its
 * original bytes are extracted in a worker (`uploads.extract-runner.ts`),
 * and the result is stored next to the original as `chat/<id>/extract.json`
 * while the row records the status and metadata. Two run at a time; rows
 * still pending at boot are picked up again by the sweep.
 */
import { storageService } from "@groot/core/storage";
import { prisma } from "@groot/core/database";
import { logger } from "@groot/core/logger";
import type { AttachmentContent } from "@tiny-agents/agent";
import { defaultRunner, type ExtractRunner } from "./uploads.extract-runner";
import { sniffFile, SniffError, type ExtractKind } from "./uploads.sniff";

const CONCURRENCY = 2;
const CACHE_SIZE = 8;

export const extractKey = (uploadId: string) => `chat/${uploadId}/extract.json`;

let runner: ExtractRunner = defaultRunner;
const queue: string[] = [];
const queued = new Set<string>();
let active = 0;
let idle: Promise<void> = Promise.resolve();
let markIdle: (() => void) | undefined;

/** Tests: run extraction with a substitute (e.g. one that never finishes). */
export function setExtractRunnerForTests(next: ExtractRunner | undefined): void {
  runner = next ?? defaultRunner;
}

/** Resolves once the queue has drained (tests and the boot sweep). */
export function extractionIdle(): Promise<void> {
  return idle;
}

export function queueExtraction(uploadId: string): void {
  if (queued.has(uploadId)) return;
  if (active === 0 && queue.length === 0) {
    idle = new Promise((resolve) => (markIdle = resolve));
  }
  queued.add(uploadId);
  queue.push(uploadId);
  pump();
}

function pump(): void {
  while (active < CONCURRENCY && queue.length > 0) {
    const uploadId = queue.shift()!;
    active += 1;
    void extractOne(uploadId)
      .catch((error: unknown) => logger.warn({ error, uploadId }, "upload.extract.failed"))
      .finally(() => {
        active -= 1;
        queued.delete(uploadId);
        if (active === 0 && queue.length === 0) markIdle?.();
        else pump();
      });
  }
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

async function extractOne(uploadId: string): Promise<void> {
  const row = await prisma.upload.findUnique({ where: { id: uploadId } });
  if (!row || row.kind !== "file" || row.extractStatus !== "pending") return;
  const started = Date.now();
  let bytes: Buffer;
  try {
    bytes = (await storageService.downloadFile({ filePath: row.storageKey })).buffer;
  } catch {
    await finish(uploadId, { extractStatus: "failed", extractError: "The file's bytes are gone." });
    return;
  }
  let kind: ExtractKind;
  try {
    kind = sniffFile(bytes, extensionOf(row.name)).kind;
  } catch (error) {
    await finish(uploadId, {
      extractStatus: "failed",
      extractError: error instanceof SniffError ? error.message : "Unrecognised file.",
    });
    return;
  }
  const result = await runner({ bytes: new Uint8Array(bytes), kind, name: row.name }, row.mimeType);
  if (result.status !== "ready") {
    await finish(uploadId, { extractStatus: result.status, extractError: result.error });
    logger.info(
      { uploadId, status: result.status, ms: Date.now() - started },
      "upload.extract.done",
    );
    return;
  }
  await storageService.uploadFile({
    filePath: extractKey(uploadId),
    fileData: Buffer.from(JSON.stringify(result.content)),
    contentType: "application/json",
  });
  await finish(uploadId, {
    extractStatus: "ready",
    extractError: null,
    extractMeta: JSON.stringify(result.meta),
  });
  // Sizes and counts only: never content.
  logger.info(
    {
      uploadId,
      status: "ready",
      ms: Date.now() - started,
      format: result.meta.format,
      pages: result.meta.pages,
      sheets: result.meta.sheets,
      entries: result.meta.entries,
      chars: result.meta.chars,
      truncated: result.meta.truncated ?? false,
    },
    "upload.extract.done",
  );
}

async function finish(
  uploadId: string,
  data: { extractStatus: string; extractError?: string | null; extractMeta?: string },
): Promise<void> {
  // The upload may have been deleted meanwhile.
  await prisma.upload
    .updateMany({ where: { id: uploadId }, data: { ...data, extractedAt: new Date() } })
    .catch(() => undefined);
}

/** Boot: rows left pending by a restart are extracted again. */
export async function extractionSweep(): Promise<number> {
  const rows = await prisma.upload.findMany({
    where: { kind: "file", extractStatus: "pending" },
    select: { id: true },
  });
  for (const row of rows) queueExtraction(row.id);
  return rows.length;
}

const cache = new Map<string, AttachmentContent>();

/** The stored extraction of a ready upload (a small LRU in front of storage). */
export async function loadContent(uploadId: string): Promise<AttachmentContent | undefined> {
  const hit = cache.get(uploadId);
  if (hit) {
    cache.delete(uploadId);
    cache.set(uploadId, hit);
    return hit;
  }
  try {
    const file = await storageService.downloadFile({ filePath: extractKey(uploadId) });
    const content = JSON.parse(file.buffer.toString("utf8")) as AttachmentContent;
    cache.set(uploadId, content);
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
    return content;
  } catch {
    return undefined;
  }
}

export function forgetContent(uploadId: string): void {
  cache.delete(uploadId);
}
