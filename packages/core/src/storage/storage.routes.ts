import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { storageRateLimiter, uploadRateLimiter } from "../middlewares/rate-limit.middleware";
import { Boom } from "../errors";
import { parseBody, parseQuery } from "../utils/controller.utils";
import { ok } from "../utils/api-response.utils";
import * as storageService from "./storage.service";
import {
  createFolderSchema,
  deleteFilesSchema,
  downloadFileSchema,
  getFileMetadataSchema,
  listFilesSchema,
  renameFileSchema,
} from "./storage.schema";
import { sanitizeFileName } from "./storage.utils";
import type { AppEnv } from "../types";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_BULK_FILES = 50;

const router = new Hono<AppEnv>();
router.use(storageRateLimiter);

const uploadLimit = bodyLimit({ maxSize: MAX_UPLOAD_BYTES });

function asFiles(value: unknown): File[] {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return list.filter((item): item is File => item instanceof File);
}

router.get("/files", async (c) => {
  const query = parseQuery(c, listFilesSchema);
  return ok(
    c,
    await storageService.listFiles({ prefix: query.prefix, delimiter: query.delimiter }),
  );
});

router.post("/files/upload", uploadRateLimiter, uploadLimit, async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) throw Boom.badRequest("No file uploaded");
  const filePath = typeof body.filePath === "string" && body.filePath ? body.filePath : file.name;
  const contentType =
    typeof body.contentType === "string" && body.contentType ? body.contentType : file.type;
  return ok(c, await storageService.uploadFile({ filePath, fileData: file, contentType }));
});

router.post("/files/bulk-upload", uploadRateLimiter, uploadLimit, async (c) => {
  const body = await c.req.parseBody({ all: true });
  const uploads = asFiles(body.files).slice(0, MAX_BULK_FILES);
  if (!uploads.length) throw Boom.badRequest("No files uploaded");
  return ok(
    c,
    await storageService.bulkUpload({
      files: uploads.map((file) => ({
        filePath: file.name,
        fileData: file,
        contentType: file.type,
      })),
    }),
  );
});

router.get("/files/download", async (c) => {
  const query = parseQuery(c, downloadFileSchema);
  const file = await storageService.downloadFile({ filePath: query.filePath });
  return c.body(file.bytes, 200, {
    "Content-Type": file.contentType,
    "Content-Disposition": `inline; ${sanitizeFileName(file.fileName)}`,
  });
});

router.delete("/files", async (c) => {
  const body = await parseBody(c, deleteFilesSchema);
  return ok(c, await storageService.deleteFiles({ filePaths: body.filePaths }));
});

router.get("/files/metadata", async (c) => {
  const query = parseQuery(c, getFileMetadataSchema);
  return ok(c, await storageService.getFileMetadata({ filePath: query.filePath }));
});

router.post("/folders", async (c) => {
  const body = await parseBody(c, createFolderSchema);
  return ok(c, await storageService.createFolder({ folderPath: body.folderPath }));
});

router.delete("/folders/:folderPath{.+}", async (c) => {
  const folderPath = decodeURIComponent(c.req.param("folderPath"));
  if (!folderPath) throw Boom.badRequest("Folder path is required");
  const normalized = folderPath.endsWith("/") ? folderPath : `${folderPath}/`;
  return ok(c, await storageService.deleteFolder({ folderPath: normalized }));
});

router.put("/files/rename", async (c) => {
  const body = await parseBody(c, renameFileSchema);
  return ok(c, await storageService.renameFile({ oldPath: body.oldPath, newPath: body.newPath }));
});

export default router;
