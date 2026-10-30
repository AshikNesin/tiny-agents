/**
 * Upload routes (issue #17): POST /uploads (multipart), GET /uploads/:id/content,
 * DELETE /uploads/:id. All JWT-protected (same-origin cookie also authorizes
 * <img src> loads in the transcript). Issue #58 adds GET /uploads/:id (the
 * live extraction state) and GET /uploads/:id/text (extracted text as JSON
 * for the read-only preview; never HTML).
 */
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { Boom } from "@groot/core/errors";
import { uploadRateLimiter } from "@groot/core/middlewares/rate-limit.middleware";
import { sanitizeFileName } from "@groot/core/storage/storage.utils";
import { createRouter } from "@groot/core/utils/router.utils";
import { parseQuery, parseStringParam } from "@groot/core/utils/controller.utils";
import { z } from "zod";
import { loadContent } from "./uploads.extraction";
import { sniffImage } from "./uploads.prepare";
import * as uploadsService from "./uploads.service";

const router = createRouter();

function parseUploadId(req: Request): string {
  const id = parseStringParam(req.params.id, "id");
  if (!/^[a-f0-9]{24}$/.test(id)) throw Boom.badRequest("Invalid upload id");
  return id;
}

/** Largest attachment accepted (the composer checks the same limit first). */
export const MAX_UPLOAD_MB = 25;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
});

/**
 * multer's limit errors are the client's doing: answer 413/400 with words
 * instead of letting them reach the generic handler as a 500 system error.
 */
function singleFile(req: Request, res: Response, next: NextFunction): void {
  upload.single("file")(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        next(Boom.entityTooLarge(`Files can be up to ${MAX_UPLOAD_MB} MB.`));
        return;
      }
      if (error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE") {
        next(Boom.badRequest('Upload one file at a time, in the "file" field.'));
        return;
      }
      next(Boom.badRequest(error.message));
      return;
    }
    next(error);
  });
}

router.post("/uploads", uploadRateLimiter, singleFile, async (req: Request) => {
  const file = req.file;
  if (!file) throw Boom.badRequest("No file uploaded");
  const stored = await uploadsService.createUpload({
    name: file.originalname,
    mimeType: file.mimetype,
    bytes: file.buffer,
  });
  return stored;
});

router.get("/uploads/:id", async (req: Request) => {
  return uploadsService.uploadStatus(parseUploadId(req));
});

const textQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  sheet: z.coerce.number().int().min(1).optional(),
});

/** One page (or sheet, up to 200 rows) of extracted text, for the preview drawer. */
router.get("/uploads/:id/text", async (req: Request) => {
  const id = parseUploadId(req);
  const { page, sheet } = parseQuery(req, textQuerySchema);
  const status = await uploadsService.uploadStatus(id);
  if (status.status !== "ready") return { status: status.status, error: status.error };
  const content = await loadContent(id);
  if (!content) return { status: "failed", error: "The extracted text is missing." };
  if (content.sheets) {
    const index = (sheet ?? 1) - 1;
    const chosen = content.sheets[index];
    if (!chosen) throw Boom.notFound("No such sheet");
    return {
      status: "ready",
      format: content.format,
      sheets: content.sheets.map((s) => ({ name: s.name, hidden: s.hidden ?? false })),
      sheet: index + 1,
      rows: chosen.rows.slice(0, 200),
      totalRows: chosen.totalRows,
    };
  }
  if (content.entries) {
    return { status: "ready", format: content.format, entries: content.entries.slice(0, 2000) };
  }
  const chosen = content.pages[page - 1];
  if (!chosen && content.pages.length > 0) throw Boom.notFound("No such page");
  return {
    status: "ready",
    format: content.format,
    page,
    pages: content.pages.length,
    label: chosen?.label ?? "",
    text: chosen?.text ?? "",
  };
});

router.get("/uploads/:id/content", async (req: Request, res: Response) => {
  const id = parseUploadId(req);
  const { bytes, ref } = await uploadsService.originalBytes(id);
  // Never let a browser second-guess the declared type (issue #58 §9.5).
  res.setHeader("X-Content-Type-Options", "nosniff");
  const sniffed = sniffImage(bytes);
  if (sniffed) {
    // Inline only for sniffed image bytes: a stored HTML file can never
    // render in-app. immutable-cacheable (uploads never change).
    res.setHeader("Content-Type", sniffed);
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.setHeader("Content-Disposition", `inline; ${sanitizeFileName(ref.name)}`);
  } else {
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.setHeader("Content-Disposition", `attachment; ${sanitizeFileName(ref.name)}`);
  }
  res.send(bytes);
  return undefined;
});

router.delete("/uploads/:id", async (req: Request) => {
  const id = parseUploadId(req);
  await uploadsService.deleteUpload(id);
  return { deleted: true };
});

export default router;
