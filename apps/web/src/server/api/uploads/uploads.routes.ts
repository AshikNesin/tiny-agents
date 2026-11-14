/**
 * Upload routes (issue #17): POST /uploads (multipart), GET /uploads/:id/content,
 * DELETE /uploads/:id. All JWT-protected (same-origin cookie also authorizes
 * <img src> loads in the transcript). Issue #58 adds GET /uploads/:id (the
 * live extraction state) and GET /uploads/:id/text (extracted text as JSON
 * for the read-only preview; never HTML).
 */
import { Hono } from "hono";
import { Boom } from "@groot/core/errors";
import { routeBodyLimit } from "@groot/core/middlewares/body-limit.middleware";
import { uploadRateLimiter } from "@groot/core/middlewares/rate-limit.middleware";
import { sanitizeFileName } from "@groot/core/storage/storage.utils";
import type { AppContext, AppEnv } from "@groot/core/types";
import { ok } from "@groot/core/utils/api-response.utils";
import type { Deleted } from "../../../shared/api/common";
import { parseQuery, parseStringParam } from "@groot/core/utils/controller.utils";
import { z } from "zod";
import { loadContent } from "./uploads.extraction";
import { sniffImage } from "./uploads.prepare";
import * as uploadsService from "./uploads.service";
import type { UploadText } from "../../../shared/api/uploads";

const router = new Hono<AppEnv>();

function parseUploadId(c: AppContext): string {
  const id = parseStringParam(c.req.param("id"), "id");
  if (!/^[a-f0-9]{24}$/.test(id)) throw Boom.badRequest("Invalid upload id");
  return id;
}

/** Largest attachment accepted (the composer checks the same limit first). */
const MAX_UPLOAD_MB = 25;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
/** Room for the multipart framing (boundaries, part headers) around the file. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/**
 * Limit errors are the client's doing: answer 413/400 with words instead of
 * letting them reach the generic handler as a 500 system error.
 */
const tooLarge = () => Boom.entityTooLarge(`Files can be up to ${MAX_UPLOAD_MB} MB.`);

/**
 * The whole request is capped before it is read; the file itself after
 * parsing. The route owns this limit in place of the app's 1 MB API default.
 */
const uploadBodyLimit = routeBodyLimit(MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES, {
  onError: () => {
    throw tooLarge();
  },
});

/**
 * The one file in the "file" field of a multipart body, or undefined when
 * there is none (a body that is not multipart carries no file).
 */
async function singleFile(c: AppContext): Promise<File | undefined> {
  if (!/^multipart\/form-data/i.test(c.req.header("content-type") ?? "")) return undefined;
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch (error) {
    throw Boom.badRequest(error instanceof Error ? error.message : "Malformed multipart body");
  }
  const files = [...form.entries()].filter(
    (entry): entry is [string, File] => entry[1] instanceof File,
  );
  if (files.length > 1 || files.some(([field]) => field !== "file")) {
    throw Boom.badRequest('Upload one file at a time, in the "file" field.');
  }
  const file = files[0]?.[1];
  if (file && file.size > MAX_UPLOAD_BYTES) throw tooLarge();
  return file;
}

router.post("/uploads", uploadRateLimiter, uploadBodyLimit, async (c) => {
  const file = await singleFile(c);
  if (!file) throw Boom.badRequest("No file uploaded");
  const stored = await uploadsService.createUpload({
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    bytes: Buffer.from(await file.arrayBuffer()),
    uploadedBy: c.get("viewer").userId,
  });
  return ok(c, stored);
});

router.get("/uploads/:id", async (c) => {
  return ok(c, await uploadsService.uploadStatus(parseUploadId(c)));
});

const textQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  sheet: z.coerce.number().int().min(1).optional(),
});

/** One page (or sheet, up to 200 rows) of extracted text, for the preview drawer. */
router.get("/uploads/:id/text", async (c) => {
  const id = parseUploadId(c);
  const { page, sheet } = parseQuery(c, textQuerySchema);
  const status = await uploadsService.uploadStatus(id);
  if (status.status !== "ready") {
    return ok<UploadText>(c, { status: status.status, error: status.error });
  }
  const content = await loadContent(id);
  if (!content) {
    return ok<UploadText>(c, { status: "failed", error: "The extracted text is missing." });
  }
  if (content.sheets) {
    const index = (sheet ?? 1) - 1;
    const chosen = content.sheets[index];
    if (!chosen) throw Boom.notFound("No such sheet");
    return ok<UploadText>(c, {
      status: "ready",
      format: content.format,
      sheets: content.sheets.map((s) => ({ name: s.name, hidden: s.hidden ?? false })),
      sheet: index + 1,
      rows: chosen.rows.slice(0, 200),
      totalRows: chosen.totalRows,
    });
  }
  if (content.entries) {
    return ok<UploadText>(c, {
      status: "ready",
      format: content.format,
      entries: content.entries.slice(0, 2000),
    });
  }
  const chosen = content.pages[page - 1];
  if (!chosen && content.pages.length > 0) throw Boom.notFound("No such page");
  return ok<UploadText>(c, {
    status: "ready",
    format: content.format,
    page,
    pages: content.pages.length,
    label: chosen?.label ?? "",
    text: chosen?.text ?? "",
  });
});

router.get("/uploads/:id/content", async (c) => {
  const id = parseUploadId(c);
  const { bytes, ref } = await uploadsService.originalBytes(id);
  // Inline only for sniffed image bytes: a stored HTML file can never
  // render in-app. immutable-cacheable (uploads never change).
  const sniffed = sniffImage(bytes);
  return c.body(bytes, 200, {
    // Never let a browser second-guess the declared type (issue #58 §9.5).
    "X-Content-Type-Options": "nosniff",
    "Content-Type": sniffed ?? "application/octet-stream",
    "Cache-Control": "private, max-age=31536000, immutable",
    "Content-Disposition": `${sniffed ? "inline" : "attachment"}; ${sanitizeFileName(ref.name)}`,
    "Content-Length": String(bytes.byteLength),
  });
});

router.delete("/uploads/:id", async (c) => {
  const id = parseUploadId(c);
  await uploadsService.deleteUpload(id);
  return ok<Deleted>(c, { deleted: true });
});

export default router;
