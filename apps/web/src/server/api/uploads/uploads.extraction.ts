/**
 * An upload's extraction (issue #58), from the moment its bytes are sniffed
 * to the text a bot reads. This module writes every move of the extraction
 * machine (`shared/machines/extraction.ts`, which draws the graph); a ready
 * row's extract.json is stored next to the original, and a row deleted
 * while its job runs keeps nothing. Each write is guarded by the states the
 * machine allows it from, so a stale worker never settles a row twice.
 *
 * Extraction runs in a worker (`uploads.extract-runner.ts`), two at a time,
 * and the result is stored as `chat/<id>/extract.json` while the row records
 * status and metadata. A send that needs the text waits on the job itself,
 * not on the table; rows still pending at boot are picked up by the sweep.
 */
import { and, eq, inArray } from "drizzle-orm";
import { storageService } from "@groot/core/storage";
import { logger } from "@groot/core/logger";
import type { AttachmentContent } from "@tiny-agents/agent";
import { db, uploads, type Upload } from "../../db";
import { extractionMachine, type ExtractStatus } from "../../../shared/machines/extraction";
import { extract } from "./uploads.extract";
import { defaultRunner, type ExtractRunner } from "./uploads.extract-runner";
import { sniffFile, SniffError, type ExtractKind, type SniffResult } from "./uploads.sniff";

const CONCURRENCY = 2;
const CACHE_SIZE = 8;

export const extractKey = (uploadId: string) => `chat/${uploadId}/extract.json`;

type UploadRow = Upload;

interface Job {
  /** The kind the upload was sniffed as, when the caller already knows it. */
  kind?: ExtractKind;
  done: Promise<void>;
  settle: () => void;
}

let runner: ExtractRunner = defaultRunner;
const queue: string[] = [];
/** Queued and running jobs by upload id. */
const jobs = new Map<string, Job>();
/** Uploads deleted while their job was queued or running: the job writes nothing. */
const cancelled = new Set<string>();
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

/**
 * The extraction columns a new upload row starts with: images have none;
 * a type nothing can read is settled now, with the reason; everything else
 * is pending and extracts in the background once the row exists.
 */
export async function initialExtraction(
  sniffed: SniffResult | undefined,
  name: string,
): Promise<Partial<Pick<UploadRow, "extractStatus" | "extractError" | "extractedAt">>> {
  if (!sniffed) return {};
  if (sniffed.kind === "unsupported") {
    const result = await extract(
      { bytes: new Uint8Array(), kind: "unsupported", name },
      sniffed.mime,
    );
    if (result.status !== "ready") {
      return { extractStatus: result.status, extractError: result.error, extractedAt: new Date() };
    }
  }
  return { extractStatus: "pending" };
}

/** A row just inserted: queue its extraction if it is pending. */
export function startExtraction(
  row: Pick<UploadRow, "id" | "kind" | "extractStatus">,
  kind?: ExtractKind,
): void {
  if (row.kind === "file" && row.extractStatus === "pending") void queueExtraction(row.id, kind);
}

/** Uploads from before extraction existed are queued the first time anyone asks. */
export async function ensureExtracting<T extends UploadRow>(row: T): Promise<T> {
  if (row.kind !== "file" || row.extractStatus !== "none") return row;
  await db
    .update(uploads)
    .set({ extractStatus: "pending" })
    .where(
      and(
        eq(uploads.id, row.id),
        inArray(uploads.extractStatus, extractionMachine.sourcesOf("pending")),
      ),
    );
  void queueExtraction(row.id);
  return { ...row, extractStatus: "pending" };
}

/**
 * The rows as they stand once their extractions have settled, or after
 * `waitMs` for those still running: a send inlines small files that finish
 * in time and leaves the rest to the tools.
 */
export async function waitUntilSettled(rows: UploadRow[], waitMs: number): Promise<UploadRow[]> {
  const pending = rows.filter((row) => row.kind === "file" && row.extractStatus === "pending");
  if (pending.length === 0) return rows;
  const settling = pending.map((row) => jobs.get(row.id)?.done ?? queueExtraction(row.id));
  await Promise.race([Promise.all(settling), sleep(waitMs)]);
  const fresh = await db
    .select()
    .from(uploads)
    .where(
      inArray(
        uploads.id,
        pending.map((row) => row.id),
      ),
    );
  const byId = new Map(fresh.map((row) => [row.id, row]));
  return rows.map((row) => byId.get(row.id) ?? row);
}

/**
 * The upload is being deleted: a queued job is dropped, a running one
 * writes nothing more (and removes what it wrote). The row and its bytes
 * are the caller's to delete.
 */
export function cancelExtraction(uploadId: string): void {
  const job = jobs.get(uploadId);
  if (!job) return;
  cancelled.add(uploadId);
  const queuedAt = queue.indexOf(uploadId);
  if (queuedAt !== -1) {
    queue.splice(queuedAt, 1);
    retire(uploadId);
  }
}

/** Queue an extraction (idempotent); resolves when its job has settled. */
export function queueExtraction(uploadId: string, kind?: ExtractKind): Promise<void> {
  const existing = jobs.get(uploadId);
  if (existing) return existing.done;
  if (jobs.size === 0) idle = new Promise((resolve) => (markIdle = resolve));
  let settle!: () => void;
  const done = new Promise<void>((resolve) => (settle = resolve));
  jobs.set(uploadId, { kind, done, settle });
  queue.push(uploadId);
  pump();
  return done;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref?.());

function retire(uploadId: string): void {
  const job = jobs.get(uploadId);
  jobs.delete(uploadId);
  cancelled.delete(uploadId);
  job?.settle();
  if (jobs.size === 0) markIdle?.();
}

function pump(): void {
  while (active < CONCURRENCY && queue.length > 0) {
    const uploadId = queue.shift()!;
    const job = jobs.get(uploadId);
    if (!job) continue;
    active += 1;
    void extractOne(uploadId, job.kind)
      .catch((error: unknown) => logger.warn({ error, uploadId }, "upload.extract.failed"))
      .finally(() => {
        active -= 1;
        retire(uploadId);
        pump();
      });
  }
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

async function extractOne(uploadId: string, kindHint: ExtractKind | undefined): Promise<void> {
  const row = await db.query.uploads.findFirst({ where: eq(uploads.id, uploadId) });
  if (!row || row.kind !== "file" || row.extractStatus !== "pending") return;
  if (cancelled.has(uploadId)) return;
  const started = Date.now();
  let bytes: Uint8Array;
  try {
    bytes = (await storageService.downloadFile({ filePath: row.storageKey })).bytes;
  } catch {
    await finish(uploadId, { extractStatus: "failed", extractError: "The file's bytes are gone." });
    return;
  }
  let kind = kindHint;
  if (!kind) {
    try {
      kind = sniffFile(bytes, extensionOf(row.name)).kind;
    } catch (error) {
      await finish(uploadId, {
        extractStatus: "failed",
        extractError: error instanceof SniffError ? error.message : "Unrecognised file.",
      });
      return;
    }
  }
  const result = await runner({ bytes: new Uint8Array(bytes), kind, name: row.name }, row.mimeType);
  if (cancelled.has(uploadId)) return;
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
    fileData: new TextEncoder().encode(JSON.stringify(result.content)),
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

/** Record a job's outcome. A row deleted meanwhile keeps nothing: the bytes written for it go too. */
async function finish(
  uploadId: string,
  data: {
    extractStatus: Exclude<ExtractStatus, "none" | "pending">;
    extractError?: string | null;
    extractMeta?: string;
  },
): Promise<void> {
  const updated = cancelled.has(uploadId)
    ? []
    : await db
        .update(uploads)
        .set({ ...data, extractedAt: new Date() })
        .where(
          and(
            eq(uploads.id, uploadId),
            inArray(uploads.extractStatus, extractionMachine.sourcesOf(data.extractStatus)),
          ),
        )
        .returning({ id: uploads.id })
        .catch(() => []);
  if (updated.length === 0 && data.extractStatus === "ready") {
    await storageService.deleteFiles({ filePaths: [extractKey(uploadId)] }).catch(() => undefined);
  }
}

/** Boot: rows left pending by a restart are extracted again. */
export async function extractionSweep(): Promise<number> {
  const rows = await db
    .select({ id: uploads.id })
    .from(uploads)
    .where(and(eq(uploads.kind, "file"), eq(uploads.extractStatus, "pending")));
  for (const row of rows) void queueExtraction(row.id);
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
    const content = JSON.parse(new TextDecoder().decode(file.bytes)) as AttachmentContent;
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
