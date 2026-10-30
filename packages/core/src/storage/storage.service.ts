import { storage } from "./storage";
import { Boom } from "../errors";
import type { StorageBody } from "./adapter";

export interface FileInfo {
  key: string;
  name: string;
  size: number;
  lastModified: Date;
  isDirectory: boolean;
}

/**
 * List one level of a "folder" under `prefix`, or every key when `delimiter`
 * is empty. Folders are the adapter's common prefixes.
 */
export async function listFiles(params: {
  prefix?: string;
  delimiter?: string;
}): Promise<FileInfo[]> {
  const { prefix = "", delimiter = "/" } = params;
  const sep = delimiter || "/";
  const directories: FileInfo[] = [];
  const files: FileInfo[] = [];

  let cursor: string | undefined;
  do {
    const page = await storage.list({
      prefix,
      delimiter: delimiter || undefined,
      cursor,
      limit: 1000,
    });
    for (const dirKey of page.prefixes) {
      const relative = dirKey.slice(prefix.length);
      const name = relative.endsWith(sep) ? relative.slice(0, -sep.length) : relative;
      directories.push({
        key: dirKey,
        name,
        size: 0,
        lastModified: new Date(0),
        isDirectory: true,
      });
    }
    for (const object of page.objects) {
      const relative = object.key.slice(prefix.length);
      if (!relative) continue;
      files.push({
        key: object.key,
        name: relative.split(sep).pop() ?? relative,
        size: object.size,
        lastModified: object.lastModified ?? new Date(0),
        isDirectory: false,
      });
    }
    cursor = page.cursor;
  } while (cursor);

  return [...directories, ...files].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function uploadFile(params: {
  filePath: string;
  fileData: StorageBody;
  contentType?: string;
}): Promise<{ filePath: string }> {
  if (!params.filePath) throw Boom.badRequest("File path is required");
  const object = await storage.put(params.filePath, params.fileData, {
    contentType: params.contentType,
  });
  return { filePath: object.key };
}

export async function bulkUpload(params: {
  files: Array<{ filePath: string; fileData: StorageBody; contentType?: string }>;
}): Promise<{ uploadedFiles: string[]; failedFiles: Array<{ filePath: string; error: string }> }> {
  const results = await Promise.allSettled(params.files.map((file) => uploadFile(file)));
  const uploadedFiles: string[] = [];
  const failedFiles: Array<{ filePath: string; error: string }> = [];
  results.forEach((result, index) => {
    const filePath = params.files[index]!.filePath;
    if (result.status === "fulfilled") uploadedFiles.push(result.value.filePath);
    else
      failedFiles.push({
        filePath,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
  });
  return { uploadedFiles, failedFiles };
}

export async function downloadFile(params: { filePath: string }): Promise<{
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
  fileName: string;
}> {
  const found = await storage.get(params.filePath);
  if (!found) throw Boom.notFound(`File not found: ${params.filePath}`);
  return {
    bytes: found.bytes,
    contentType: found.object.contentType,
    fileName: params.filePath.split("/").pop() ?? "file",
  };
}

export async function deleteFiles(params: {
  filePaths: string[];
}): Promise<{ deletedCount: number }> {
  if (!params.filePaths.length) throw Boom.badRequest("No files specified for deletion");
  return { deletedCount: await storage.delete(params.filePaths) };
}

export async function getFileMetadata(params: { filePath: string }): Promise<{
  exists: boolean;
  size?: number;
  lastModified?: Date;
  fileName: string;
}> {
  const fileName = params.filePath.split("/").pop() ?? params.filePath;
  const object = await storage.head(params.filePath);
  if (!object) return { exists: false, fileName };
  return {
    exists: true,
    size: object.size,
    lastModified: object.lastModified ?? undefined,
    fileName,
  };
}

export async function createFolder({
  folderPath,
}: {
  folderPath: string;
}): Promise<{ folderPath: string }> {
  if (!folderPath.endsWith("/")) throw Boom.badRequest("Folder path must end with /");
  await storage.put(`${folderPath}.keep`, "", { contentType: "text/plain" });
  return { folderPath };
}

export async function deleteFolder({
  folderPath,
}: {
  folderPath: string;
}): Promise<{ deletedCount: number }> {
  if (!folderPath.endsWith("/")) throw Boom.badRequest("Folder path must end with /");
  let deletedCount = 0;
  let cursor: string | undefined;
  do {
    const page = await storage.list({ prefix: folderPath, cursor, limit: 1000 });
    if (page.objects.length) deletedCount += await storage.delete(page.objects.map((o) => o.key));
    cursor = page.cursor;
  } while (cursor);
  return { deletedCount };
}

export async function copyFile(params: {
  oldPath: string;
  newPath: string;
}): Promise<{ newPath: string }> {
  if (!(await storage.head(params.oldPath))) {
    throw Boom.notFound(`Source file not found: ${params.oldPath}`);
  }
  await storage.copy(params.oldPath, params.newPath);
  return { newPath: params.newPath };
}

export async function renameFile(params: {
  oldPath: string;
  newPath: string;
}): Promise<{ newPath: string }> {
  await copyFile(params);
  await storage.delete([params.oldPath]);
  return { newPath: params.newPath };
}
