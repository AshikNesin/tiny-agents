import { z } from "zod";

export interface FileInfo {
  key: string;
  name: string;
  size: number;
  lastModified: string | null;
  isDirectory: boolean;
}

export interface UploadFilesResult {
  uploadedFiles: string[];
  failedFiles: Array<{ filePath: string; error: string }>;
}

export const MAX_UPLOAD_FILES = 50;

const isSegment = (segment: string) =>
  segment !== "" && segment !== "." && segment !== ".." && !segment.includes("\\");

const isKey = (path: string) => path.split("/").every(isSegment);

export function isActiveContentType(contentType: string): boolean {
  return /html|svg|xml|javascript/i.test(contentType);
}

const isFileName = (name: string) => !name.includes("/") && isSegment(name);

export const filePathSchema = z
  .string()
  .min(1, "File path is required")
  .refine(isKey, "Invalid file path");

export const folderPathSchema = z
  .string()
  .transform((value) => value.replace(/^\/+|\/+$/g, ""))
  .refine((value) => value === "" || isKey(value), "Invalid folder path")
  .transform((value) => (value ? `${value}/` : ""));

const requiredFolderPathSchema = folderPathSchema.refine(Boolean, "Folder path is required");

export const listFilesSchema = z.object({
  folder: folderPathSchema.default(""),
});

export const uploadFilesSchema = z.object({
  file: z.preprocess(
    (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]),
    z
      .array(z.instanceof(File).refine((file) => isFileName(file.name), "Invalid file name"))
      .min(1, "No file uploaded")
      .max(MAX_UPLOAD_FILES, `At most ${MAX_UPLOAD_FILES} files per upload`),
  ),
  folder: folderPathSchema.default(""),
});

export const downloadFileSchema = z.object({
  filePath: filePathSchema,
});

export const deleteFilesSchema = z.object({
  filePaths: z.array(filePathSchema).min(1, "At least one file path is required"),
});

export const createFolderSchema = z.object({
  folderPath: requiredFolderPathSchema,
});

export const deleteFolderSchema = z.object({
  folderPath: requiredFolderPathSchema,
});

export const renameFileSchema = z.object({
  oldPath: filePathSchema,
  newPath: filePathSchema,
});
