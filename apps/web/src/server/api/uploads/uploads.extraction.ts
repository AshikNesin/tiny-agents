import { and, eq, inArray } from "drizzle-orm";
import { storageService } from "@groot/core/storage";
import { logger } from "@groot/core/logger";
import type { AttachmentContent } from "@tiny-agents/agent";
import { db, uploads, type Upload } from "../../db";
import { app } from "../../app-root";
import { extractionMachine, type ExtractStatus } from "../../../shared/machines/extraction";
import { extract } from "./uploads.extract";
import { defaultRunner, type ExtractRunner } from "./uploads.extract-runner";
import { sniffFile, SniffError, type ExtractKind, type SniffResult } from "./uploads.sniff";

const CONCURRENCY = 2;
const CACHE_SIZE = 8;

export const extractKey = (uploadId: string) => `chat/${uploadId}/extract.json`;

type UploadRow = Upload;

interface Job {
  kind?: ExtractKind;
  done: Promise<void>;
  settle: () => void;
}

export interface ExtractionState {
  runner?: ExtractRunner;
  queue: string[];
  jobs: Map<string, Job>;
  cancelled: Set<string>;
  active: number;
  idle: Promise<void>;
  markIdle?: () => void;
  cache: Map<string, AttachmentContent>;
}

const state = () => app().uploadExtraction;

export function setExtractRunner(next: ExtractRunner): void {
  state().runner = next;
}

export function extractionIdle(): Promise<void> {
  return state().idle;
}

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

export function startExtraction(
  row: Pick<UploadRow, "id" | "kind" | "extractStatus">,
  kind?: ExtractKind,
): void {
  if (row.kind === "file" && row.extractStatus === "pending") void queueExtraction(row.id, kind);
}

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

export async function waitUntilSettled(rows: UploadRow[], waitMs: number): Promise<UploadRow[]> {
  const pending = rows.filter((row) => row.kind === "file" && row.extractStatus === "pending");
  if (pending.length === 0) return rows;
  const settling = pending.map((row) => state().jobs.get(row.id)?.done ?? queueExtraction(row.id));
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

export function cancelExtraction(uploadId: string): void {
  const job = state().jobs.get(uploadId);
  if (!job) return;
  state().cancelled.add(uploadId);
  const queuedAt = state().queue.indexOf(uploadId);
  if (queuedAt !== -1) {
    state().queue.splice(queuedAt, 1);
    retire(uploadId);
  }
}

export function queueExtraction(uploadId: string, kind?: ExtractKind): Promise<void> {
  const existing = state().jobs.get(uploadId);
  if (existing) return existing.done;
  if (state().jobs.size === 0)
    state().idle = new Promise((resolve) => (state().markIdle = resolve));
  let settle!: () => void;
  const done = new Promise<void>((resolve) => (settle = resolve));
  state().jobs.set(uploadId, { kind, done, settle });
  state().queue.push(uploadId);
  pump();
  return done;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref?.());

function retire(uploadId: string): void {
  const job = state().jobs.get(uploadId);
  state().jobs.delete(uploadId);
  state().cancelled.delete(uploadId);
  job?.settle();
  if (state().jobs.size === 0) state().markIdle?.();
}

function pump(): void {
  while (state().active < CONCURRENCY && state().queue.length > 0) {
    const uploadId = state().queue.shift()!;
    const job = state().jobs.get(uploadId);
    if (!job) continue;
    state().active += 1;
    void extractOne(uploadId, job.kind)
      .catch((error: unknown) => logger.warn({ error, uploadId }, "upload.extract.failed"))
      .finally(() => {
        state().active -= 1;
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
  if (state().cancelled.has(uploadId)) return;
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
  const result = await (state().runner ?? defaultRunner)(
    { bytes: new Uint8Array(bytes), kind, name: row.name },
    row.mimeType,
  );
  if (state().cancelled.has(uploadId)) return;
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
  data: {
    extractStatus: Exclude<ExtractStatus, "none" | "pending">;
    extractError?: string | null;
    extractMeta?: string;
  },
): Promise<void> {
  const updated = state().cancelled.has(uploadId)
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

export async function extractionSweep(): Promise<number> {
  const rows = await db
    .select({ id: uploads.id })
    .from(uploads)
    .where(and(eq(uploads.kind, "file"), eq(uploads.extractStatus, "pending")));
  for (const row of rows) void queueExtraction(row.id);
  return rows.length;
}

export async function loadContent(uploadId: string): Promise<AttachmentContent | undefined> {
  const hit = state().cache.get(uploadId);
  if (hit) {
    state().cache.delete(uploadId);
    state().cache.set(uploadId, hit);
    return hit;
  }
  try {
    const file = await storageService.downloadFile({ filePath: extractKey(uploadId) });
    const content = JSON.parse(new TextDecoder().decode(file.bytes)) as AttachmentContent;
    state().cache.set(uploadId, content);
    if (state().cache.size > CACHE_SIZE) state().cache.delete(state().cache.keys().next().value!);
    return content;
  } catch {
    return undefined;
  }
}

export function forgetContent(uploadId: string): void {
  state().cache.delete(uploadId);
}
