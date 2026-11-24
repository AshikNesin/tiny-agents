import { Hono } from "hono";
import { routeBodyLimit } from "../middlewares/body-limit.middleware";
import { storageRateLimiter, uploadRateLimiter } from "../middlewares/rate-limit.middleware";
import { parseBody, parseForm, parseParams, parseQuery } from "../utils/controller.utils";
import { noContent, ok } from "../utils/api-response.utils";
import * as storageService from "./storage.service";
import {
  createFolderSchema,
  deleteFilesSchema,
  deleteFolderSchema,
  downloadFileSchema,
  isActiveContentType,
  listFilesSchema,
  renameFileSchema,
  uploadFilesSchema,
} from "./storage.schema";
import { sanitizeFileName } from "./storage.utils";
import type { AppEnv } from "../types";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

const router = new Hono<AppEnv>();
router.use(storageRateLimiter);

router.get("/files", async (c) => {
  const query = parseQuery(c, listFilesSchema);
  return ok(c, await storageService.listFiles({ folder: query.folder }));
});

router.post("/files/upload", uploadRateLimiter, routeBodyLimit(MAX_UPLOAD_BYTES), async (c) => {
  const form = await parseForm(c, uploadFilesSchema);
  return ok(
    c,
    await storageService.uploadFiles({
      files: form.file.map((file) => ({
        filePath: `${form.folder}${file.name}`,
        fileData: file,
        contentType: file.type,
      })),
    }),
  );
});

function withTextCharset(contentType: string): string {
  if (!/^text\//i.test(contentType) || /;\s*charset=/i.test(contentType)) return contentType;
  return `${contentType}; charset=utf-8`;
}

router.get("/files/download", async (c) => {
  const query = parseQuery(c, downloadFileSchema);
  const file = await storageService.downloadFile({ filePath: query.filePath });
  const active = isActiveContentType(file.contentType);
  return c.body(file.bytes, 200, {
    "Content-Type": withTextCharset(file.contentType),
    "Content-Disposition": `${active ? "attachment" : "inline"}; ${sanitizeFileName(file.fileName)}`,
    "X-Content-Type-Options": "nosniff",
  });
});

router.delete("/files", async (c) => {
  const body = await parseBody(c, deleteFilesSchema);
  await storageService.deleteFiles({ filePaths: body.filePaths });
  return noContent(c);
});

router.put("/files/rename", async (c) => {
  const body = await parseBody(c, renameFileSchema);
  return ok(c, await storageService.renameFile({ oldPath: body.oldPath, newPath: body.newPath }));
});

router.post("/folders", async (c) => {
  const body = await parseBody(c, createFolderSchema);
  return ok(c, await storageService.createFolder({ folderPath: body.folderPath }));
});

router.delete("/folders/:folderPath{.+}", async (c) => {
  const params = parseParams(c, deleteFolderSchema);
  return ok(c, await storageService.deleteFolder({ folderPath: params.folderPath }));
});

export default router;
