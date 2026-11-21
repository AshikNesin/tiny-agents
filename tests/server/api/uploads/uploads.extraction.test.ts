import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { storageService } from "@groot/core/storage";
import { db, uploads } from "../../../../apps/web/src/server/db";
import {
  cancelExtraction,
  ensureExtracting,
  extractionIdle,
  extractKey,
  queueExtraction,
  setExtractRunner,
  waitUntilSettled,
} from "../../../../apps/web/src/server/api/uploads/uploads.extraction";
import { deleteUpload } from "../../../../apps/web/src/server/api/uploads/uploads.service";
import {
  createWorkerRunner,
  inProcessRunner,
  type WorkerLike,
} from "../../../../apps/web/src/server/api/uploads/uploads.extract-runner";
import type { ExtractResult } from "../../../../apps/web/src/server/api/uploads/uploads.extract";
import type { ExtractStatus } from "../../../../apps/web/src/shared/machines/extraction";

let seq = 0;

async function seedFile(extractStatus: ExtractStatus, text = "hello") {
  const id = `upl-${++seq}-${Date.now().toString(36)}`;
  const storageKey = `chat/${id}/original`;
  await storageService.uploadFile({
    filePath: storageKey,
    fileData: Buffer.from(text),
    contentType: "text/plain",
  });
  const [row] = await db
    .insert(uploads)
    .values({
      id,
      kind: "file",
      name: "notes.txt",
      mimeType: "text/plain",
      size: text.length,
      modelKey: null,
      storageKey,
      sha256: "x",
      extractStatus,
    })
    .returning();
  return row!;
}

const rowOf = (id: string) => db.query.uploads.findFirst({ where: eq(uploads.id, id) });

function gate() {
  let release!: (result: ExtractResult) => void;
  const held = new Promise<ExtractResult>((resolve) => (release = resolve));
  const ready: ExtractResult = {
    status: "ready",
    content: { format: "text", pages: [{ label: "1", text: "hello" }] },
    meta: { format: "text", chars: 5 },
  };
  return { runner: () => held, release: () => release(ready) };
}

describe("extraction owns extractStatus", () => {
  beforeEach(async () => {
    await db.delete(uploads);
  });
  afterEach(async () => {
    setExtractRunner(inProcessRunner);
    await extractionIdle();
    await db.delete(uploads);
  });

  it("waitUntilSettled waits on the job, gives up after the wait, and sees the result once it lands", async () => {
    const g = gate();
    setExtractRunner(g.runner);
    const row = await seedFile("pending");
    void queueExtraction(row.id);

    const stillPending = await waitUntilSettled([row], 50);
    expect(stillPending[0]!.extractStatus).toBe("pending");

    const settled = waitUntilSettled([row], 5_000);
    g.release();
    expect((await settled)[0]!.extractStatus).toBe("ready");
    await storageService.downloadFile({ filePath: extractKey(row.id) });
  });

  it("a delete during extraction cancels the job: no row, no extract.json, no orphan bytes", async () => {
    const g = gate();
    setExtractRunner(g.runner);
    const row = await seedFile("pending");
    const job = queueExtraction(row.id);
    await new Promise((r) => setTimeout(r, 10));

    await deleteUpload(row.id);
    g.release();
    await job;

    expect(await rowOf(row.id)).toBeUndefined();
    await expect(storageService.downloadFile({ filePath: extractKey(row.id) })).rejects.toThrow();
    await expect(storageService.downloadFile({ filePath: row.storageKey })).rejects.toThrow();
  });

  it("cancelling a job still in the queue drops it without running", async () => {
    const g = gate();
    let runs = 0;
    setExtractRunner(() => {
      runs += 1;
      return g.runner();
    });
    const [a, b, c] = [
      await seedFile("pending"),
      await seedFile("pending"),
      await seedFile("pending"),
    ];
    void queueExtraction(a.id);
    void queueExtraction(b.id);
    const third = queueExtraction(c.id);
    await new Promise((r) => setTimeout(r, 10));
    cancelExtraction(c.id);
    await third;
    expect(runs).toBe(2);
    expect((await rowOf(c.id))?.extractStatus).toBe("pending");
    g.release();
  });

  it("an upload from before extraction existed is queued the first time anyone asks", async () => {
    const row = await seedFile("none");
    const asked = await ensureExtracting(row);
    expect(asked.extractStatus).toBe("pending");
    await extractionIdle();
    expect((await rowOf(row.id))?.extractStatus).toBe("ready");
    expect((await ensureExtracting((await rowOf(row.id))!)).extractStatus).toBe("ready");
  });
});

describe("worker runner", () => {
  type Handler = (payload: never) => void;
  function fakeWorker() {
    const handlers = new Map<string, Handler>();
    let terminated = 0;
    const worker: WorkerLike = {
      once: (event: string, listener: Handler) => handlers.set(event, listener),
      terminate: () => {
        terminated += 1;
      },
    };
    return {
      worker,
      emit: (event: string, payload: unknown) => handlers.get(event)?.(payload as never),
      get terminated() {
        return terminated;
      },
    };
  }
  const input = { bytes: new Uint8Array(), kind: "text" as const, name: "a.txt" };

  it("resolves with the worker's message and terminates it", async () => {
    const w = fakeWorker();
    const run = createWorkerRunner({ spawn: () => w.worker })(input, "text/plain");
    w.emit("message", { status: "failed", error: "nope" });
    expect(await run).toEqual({ status: "failed", error: "nope" });
    expect(w.terminated).toBe(1);
  });

  it("times out, and a later message changes nothing", async () => {
    const w = fakeWorker();
    const run = createWorkerRunner({ spawn: () => w.worker, timeoutMs: 20 })(input, "text/plain");
    expect(await run).toEqual({ status: "failed", error: "Extraction timed out." });
    w.emit("message", { status: "ready" });
    expect(w.terminated).toBe(1);
  });

  it("reports out-of-memory, crashes and unexpected exits in words", async () => {
    const oom = fakeWorker();
    const oomRun = createWorkerRunner({ spawn: () => oom.worker })(input, "text/plain");
    oom.emit("error", Object.assign(new Error("oom"), { code: "ERR_WORKER_OUT_OF_MEMORY" }));
    expect(await oomRun).toEqual({
      status: "failed",
      error: "The file needs too much memory to read.",
    });

    const crash = fakeWorker();
    const crashRun = createWorkerRunner({ spawn: () => crash.worker })(input, "text/plain");
    crash.emit("error", new Error("boom"));
    expect(await crashRun).toEqual({ status: "failed", error: "Extraction crashed." });

    const exit = fakeWorker();
    const exitRun = createWorkerRunner({ spawn: () => exit.worker })(input, "text/plain");
    exit.emit("exit", 1);
    expect(await exitRun).toEqual({ status: "failed", error: "Extraction stopped unexpectedly." });
  });
});
