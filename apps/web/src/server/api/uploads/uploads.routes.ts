import { routes } from "../routes";
import { Boom } from "@groot/core/errors";
import { routeBodyLimit } from "@groot/core/middlewares/body-limit.middleware";
import { uploadRateLimiter } from "@groot/core/middlewares/rate-limit.middleware";
import { sanitizeFileName } from "@groot/core/storage/storage.utils";
import type { AppContext } from "@groot/core/types";
import { ok } from "@groot/core/utils/api-response.utils";
import type { Deleted } from "../../../shared/api/common";
import { parseQuery, parseStringParam } from "@groot/core/utils/controller.utils";
import { z } from "zod";
import { loadContent } from "./uploads.extraction";
import { sniffImage } from "./uploads.prepare";
import * as uploadsService from "./uploads.service";
import type { UploadText } from "../../../shared/api/uploads";

const router = routes();

function parseUploadId(c: AppContext): string {
  const id = parseStringParam(c.req.param("id"), "id");
  if (!/^[a-f0-9]{24}$/.test(id)) throw Boom.badRequest("Invalid upload id");
  return id;
}

const MAX_UPLOAD_MB = 25;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

const tooLarge = () => Boom.entityTooLarge(`Files can be up to ${MAX_UPLOAD_MB} MB.`);

const uploadBodyLimit = routeBodyLimit(MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES, {
  onError: () => {
    throw tooLarge();
  },
});

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

router.post("/uploads", "signedIn", uploadRateLimiter, uploadBodyLimit, async (c) => {
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
  const sniffed = sniffImage(bytes);
  return c.body(bytes, 200, {
    "X-Content-Type-Options": "nosniff",
    "Content-Type": sniffed ?? "application/octet-stream",
    "Cache-Control": "private, max-age=31536000, immutable",
    "Content-Disposition": `${sniffed ? "inline" : "attachment"}; ${sanitizeFileName(ref.name)}`,
    "Content-Length": String(bytes.byteLength),
  });
});

router.delete("/uploads/:id", "signedIn", async (c) => {
  const id = parseUploadId(c);
  await uploadsService.deleteUpload(id);
  return ok<Deleted>(c, { deleted: true });
});

export default router.hono;
