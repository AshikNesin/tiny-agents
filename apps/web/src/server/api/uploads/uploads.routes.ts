/**
 * Upload routes (issue #17): POST /uploads (multipart), GET /uploads/:id/content,
 * DELETE /uploads/:id. All JWT-protected (same-origin cookie also authorizes
 * <img src> loads in the transcript).
 */
import type { Request, Response } from "express";
import multer from "multer";
import { Boom } from "@groot/core/errors";
import { uploadRateLimiter } from "@groot/core/middlewares/rate-limit.middleware";
import { sanitizeFileName } from "@groot/core/storage/storage.utils";
import { createRouter } from "@groot/core/utils/router.utils";
import { parseStringParam } from "@groot/core/utils/controller.utils";
import { sniffImage } from "./uploads.prepare";
import * as uploadsService from "./uploads.service";

const router = createRouter();

function parseUploadId(req: Request): string {
  const id = parseStringParam(req.params.id, "id");
  if (!/^[a-f0-9]{24}$/.test(id)) throw Boom.badRequest("Invalid upload id");
  return id;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});

router.post("/uploads", uploadRateLimiter, upload.single("file"), async (req: Request) => {
  const file = req.file;
  if (!file) throw Boom.badRequest("No file uploaded");
  const stored = await uploadsService.createUpload({
    name: file.originalname,
    mimeType: file.mimetype,
    bytes: file.buffer,
  });
  return stored;
});

router.get("/uploads/:id/content", async (req: Request, res: Response) => {
  const id = parseUploadId(req);
  const { bytes, ref } = await uploadsService.originalBytes(id);
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
