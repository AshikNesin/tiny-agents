import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@groot/shell/lib/api";
import type { FileInfo, UploadFilesResult } from "@groot/core/storage/storage.schema";

export type StorageFile = FileInfo;
export type UploadResult = UploadFilesResult;

export const storageKeys = {
  root: ["storage"] as const,
  files: (folder: string) => [...storageKeys.root, "files", folder] as const,
};

export const storageApi = {
  list: (folder: string) =>
    apiClient.get<StorageFile[]>("/storage/files", { folder: folder || undefined }),
  upload: (files: File[], folder: string) => {
    const formData = new FormData();
    for (const file of files) formData.append("file", file);
    formData.append("folder", folder);
    return apiClient.postForm<UploadResult>("/storage/files/upload", formData);
  },
  deleteFiles: (filePaths: string[]) => apiClient.delete<void>("/storage/files", { filePaths }),
  createFolder: (folderPath: string) =>
    apiClient.post<{ folderPath: string }>("/storage/folders", { folderPath }),
  deleteFolder: (folderPath: string) =>
    apiClient.delete<{ deletedCount: number }>(
      `/storage/folders/${encodeURIComponent(folderPath)}`,
    ),
  rename: (oldPath: string, newPath: string) =>
    apiClient.put<{ newPath: string }>("/storage/files/rename", { oldPath, newPath }),
};

export async function downloadFile(filePath: string, name: string): Promise<void> {
  const link = document.createElement("a");
  link.href = apiClient.url("/storage/files/download", { filePath });
  link.download = name;
  link.click();
}

export async function viewFile(filePath: string): Promise<void> {
  const win = window.open("", "_blank");
  const url = apiClient.url("/storage/files/download", { filePath });
  if (win) win.location.href = url;
  else window.location.href = url;
}

export function useStorageFiles(folder: string) {
  return useQuery({
    queryKey: storageKeys.files(folder),
    queryFn: () => storageApi.list(folder),
  });
}

export function useUploadFiles() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { files: File[]; folder: string }) =>
      storageApi.upload(params.files, params.folder),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: storageKeys.root });
    },
  });
}

export function useDeleteFiles() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: storageApi.deleteFiles,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: storageKeys.root });
    },
  });
}

export function useCreateFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: storageApi.createFolder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: storageKeys.root });
    },
  });
}

export function useDeleteFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: storageApi.deleteFolder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: storageKeys.root });
    },
  });
}

export function useRenameFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { oldPath: string; newPath: string }) =>
      storageApi.rename(params.oldPath, params.newPath),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: storageKeys.root });
    },
  });
}
