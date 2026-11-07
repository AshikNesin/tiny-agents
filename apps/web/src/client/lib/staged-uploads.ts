/**
 * Attachments staged in a composer (the bot chat's and the Code page's):
 * each file uploads as soon as it is staged and is sent by its ref. One
 * status vocabulary, one cap, one size check before uploading, and one rule
 * for uploads nobody will send: an item removed (or the message sent, or
 * the draft switched) while its file was still uploading is deleted once
 * the upload lands instead of being leaked.
 *
 * The upload and its delete are injected, so the same helper serves the
 * bots API (`AttachmentRef`) and a Code harness (a string ref), and the
 * tests drive it without a network.
 */
import { errorMessage } from "./errors";

/** Most attachments one message can carry. */
export const MAX_ATTACHMENTS = 10;
/** The server's per-file limit (uploads.routes.ts, code.routes.ts), checked before uploading. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

type StagedStatus = "uploading" | "done" | "error";

export interface StagedUpload<Ref> {
  key: string;
  name: string;
  status: StagedStatus;
  /** Why it failed, readably (status "error"). */
  error?: string;
  /** A thumbnail for an image: an object URL, or the server's copy once restored. */
  previewUrl?: string;
  /** Set when done. */
  ref?: Ref;
}

/** What staging needs from the composer and its API. */
export interface Staging<Ref> {
  upload(file: File): Promise<Ref>;
  /** Delete an upload nothing will send; leave out when the API has none. */
  deleteUpload?(ref: Ref): Promise<unknown>;
  /** The staged list as it is now (read again when an upload lands). */
  current(): StagedUpload<Ref>[];
  /** Apply a change to the staged list. */
  update(change: (staged: StagedUpload<Ref>[]) => StagedUpload<Ref>[]): void;
  /** Say what went wrong, once (a toast). */
  notify(message: string): void;
  /** A thumbnail for an image file (an object URL); leave out for none. */
  previewUrl?(file: File): string | undefined;
  /** Release a thumbnail made by `previewUrl`. */
  releasePreview?(url: string): void;
}

export function humanSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

let pastedCount = 0;

/** The name a file uploads under: a pasted image has none of its own. */
function stagedName(file: File): string {
  return file.name || `pasted-image-${++pastedCount}.png`;
}

/** The ready refs, in staged order: what a send carries. */
export function readyRefs<Ref>(staged: StagedUpload<Ref>[]): Ref[] {
  return staged.flatMap((item) => (item.status === "done" && item.ref ? [item.ref] : []));
}

export function isUploading<Ref>(staged: StagedUpload<Ref>[]): boolean {
  return staged.some((item) => item.status === "uploading");
}

/** Whether another file may be staged. */
export function canStageMore<Ref>(staged: StagedUpload<Ref>[]): boolean {
  return staged.length < MAX_ATTACHMENTS;
}

/**
 * Stage files and upload them. Past the cap the rest are dropped (with one
 * notice when none fit); a file over the size limit is staged as an error
 * without uploading. Resolves once every upload has settled.
 */
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
          // Removed (or sent without it) while uploading: nothing will ever
          // reference this upload, so delete it instead of leaking it.
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
          // A tile or chip has no room for the reason; say it once, readably.
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

/** Take one item off the strip: release its thumbnail and delete its upload. */
export function unstageUpload<Ref>(item: StagedUpload<Ref>, staging: Staging<Ref>): void {
  staging.update((current) => current.filter((candidate) => candidate.key !== item.key));
  if (item.previewUrl) staging.releasePreview?.(item.previewUrl);
  if (item.ref !== undefined) void staging.deleteUpload?.(item.ref).catch(() => undefined);
}
