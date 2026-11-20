import { errorMessage } from "./errors";

export const MAX_ATTACHMENTS = 10;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

type StagedStatus = "uploading" | "done" | "error";

export interface StagedUpload<Ref> {
  key: string;
  name: string;
  status: StagedStatus;
  error?: string;
  previewUrl?: string;
  ref?: Ref;
}

export interface Staging<Ref> {
  upload(file: File): Promise<Ref>;
  deleteUpload?(ref: Ref): Promise<unknown>;
  current(): StagedUpload<Ref>[];
  update(change: (staged: StagedUpload<Ref>[]) => StagedUpload<Ref>[]): void;
  notify(message: string): void;
  previewUrl?(file: File): string | undefined;
  releasePreview?(url: string): void;
}

export function humanSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

let pastedCount = 0;

function stagedName(file: File): string {
  return file.name || `pasted-image-${++pastedCount}.png`;
}

export function readyRefs<Ref>(staged: StagedUpload<Ref>[]): Ref[] {
  return staged.flatMap((item) => (item.status === "done" && item.ref ? [item.ref] : []));
}

export function isUploading<Ref>(staged: StagedUpload<Ref>[]): boolean {
  return staged.some((item) => item.status === "uploading");
}

export function canStageMore<Ref>(staged: StagedUpload<Ref>[]): boolean {
  return staged.length < MAX_ATTACHMENTS;
}

export async function stageUploads<Ref>(
  files: Iterable<File>,
  staging: Staging<Ref>,
): Promise<void> {
  const room = MAX_ATTACHMENTS - staging.current().length;
  if (room <= 0) {
    staging.notify(`Up to ${MAX_ATTACHMENTS} attachments per message`);
    return;
  }
  const uploads: Promise<void>[] = [];
  for (const file of Array.from(files).slice(0, room)) {
    const key = crypto.randomUUID();
    const name = stagedName(file);
    const previewUrl = file.type.startsWith("image/") ? staging.previewUrl?.(file) : undefined;
    if (file.size > MAX_UPLOAD_BYTES) {
      const error = `${name} is ${humanSize(file.size)}; files can be up to 25 MB.`;
      staging.update((current) => [...current, { key, name, status: "error", error, previewUrl }]);
      staging.notify(error);
      continue;
    }
    staging.update((current) => [...current, { key, name, status: "uploading", previewUrl }]);
    const named = new File([file], name, { type: file.type || "application/octet-stream" });
    uploads.push(
      staging.upload(named).then(
        (ref) => {
          if (!staging.current().some((item) => item.key === key)) {
            void staging.deleteUpload?.(ref).catch(() => undefined);
            return;
          }
          staging.update((current) =>
            current.map((item) => (item.key === key ? { ...item, status: "done", ref } : item)),
          );
        },
        (error: unknown) => {
          const message = errorMessage(error, "Upload failed");
          staging.notify(`${name}: ${message}`);
          staging.update((current) =>
            current.map((item) =>
              item.key === key ? { ...item, status: "error", error: message } : item,
            ),
          );
        },
      ),
    );
  }
  await Promise.all(uploads);
}

export function unstageUpload<Ref>(item: StagedUpload<Ref>, staging: Staging<Ref>): void {
  staging.update((current) => current.filter((candidate) => candidate.key !== item.key));
  if (item.previewUrl) staging.releasePreview?.(item.previewUrl);
  if (item.ref !== undefined) void staging.deleteUpload?.(item.ref).catch(() => undefined);
}
