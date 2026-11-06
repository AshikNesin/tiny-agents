/** Attachment UI (issue #17): composer staging chips and transcript rendering. */
import { useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileText, Loader2, X } from "lucide-react";
import { Button } from "@groot/ui/button";
import { botsApi, type AttachmentRef } from "../lib/bots-api";
import { humanSize, type StagedUpload } from "../lib/staged-uploads";
import { FilePreviewDialog, statusLabel, useUploadStatus } from "./FilePreview";

/** Placeholder until an upload has a ref: an image ref is never polled. */
const NO_FILE: AttachmentRef = { uploadId: "", kind: "image", name: "", mimeType: "", size: 0 };

/** One staged item in the composer: thumbnail (image) or chip (file). */
export function StagedAttachment({
  attachment,
  onRemove,
}: {
  attachment: StagedItem;
  onRemove: () => void;
}) {
  const uploading = attachment.status === "uploading";
  const failed = attachment.status === "error";
  // Once uploaded, a file shows its extraction state (issue #58).
  const live = useUploadStatus(attachment.ref ?? NO_FILE);
  const label = statusLabel(live);
  return (
    <div
      className={`bg-secondary/60 relative size-16 shrink-0 overflow-hidden rounded-xl border ${
        failed ? "border-destructive" : "border-border"
      }`}
    >
      {attachment.previewUrl ? (
        <img
          src={attachment.previewUrl}
          alt={attachment.name}
          className="size-full object-cover"
          data-testid="staged-image"
        />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-0.5 p-1">
          <FileText className="text-muted-foreground size-5 shrink-0" />
          <span
            className="w-full truncate text-center text-[10px] leading-tight"
            title={live?.error ?? attachment.name}
          >
            {attachment.name}
          </span>
          {label && (
            <span className="text-muted-foreground w-full truncate text-center text-[10px] leading-tight">
              {label}
            </span>
          )}
        </div>
      )}
      {uploading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/60">
          <Loader2 className="size-5 animate-spin" />
        </div>
      )}
      {failed && (
        <div
          className="text-destructive bg-background absolute inset-0 flex items-center justify-center p-1 text-center text-[10px] leading-tight"
          title={attachment.error}
          role="img"
          aria-label={`${attachment.name}: ${attachment.error ?? "upload failed"}`}
        >
          Upload failed
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${attachment.name}`}
        className="bg-background/80 hover:bg-background absolute top-0.5 right-0.5 rounded-full p-0.5"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

/** A bot chat attachment staged in the composer (lib/staged-uploads.ts). */
export type StagedItem = StagedUpload<AttachmentRef>;

/**
 * A sent file: name, size and its live extraction state (issue #58). The
 * chip opens the text-only preview; the icon downloads the original.
 */
function FileChip({ file, onOpen }: { file: AttachmentRef; onOpen: () => void }) {
  const status = useUploadStatus(file);
  const label = statusLabel(status);
  const failed = status?.status === "failed";
  return (
    <div className="bg-secondary/60 flex max-w-72 items-center rounded-full text-xs">
      <button
        type="button"
        onClick={onOpen}
        className="hover:bg-secondary flex min-h-9 min-w-0 items-center gap-2 rounded-l-full py-1.5 pr-1 pl-3"
        title={status?.error ?? `${file.name} (${humanSize(file.size)})`}
        aria-label={`Preview ${file.name}`}
      >
        <FileText className="text-muted-foreground size-3.5 shrink-0" />
        <span className="truncate">{file.name}</span>
        <span className={`shrink-0 ${failed ? "text-destructive" : "text-muted-foreground"}`}>
          {label ?? humanSize(file.size)}
        </span>
      </button>
      <a
        href={botsApi.uploadUrl(file.uploadId)}
        download={file.name}
        className="hover:bg-secondary flex min-h-9 items-center rounded-r-full py-1.5 pr-3 pl-1.5"
        aria-label={`Download ${file.name}`}
      >
        <Download className="text-muted-foreground size-3 shrink-0" />
      </a>
    </div>
  );
}

/** Attachments on a transcript user message: thumbnails and file chips. */
export function MessageAttachments({ attachments }: { attachments: AttachmentRef[] }) {
  const [enlarged, setEnlarged] = useState<AttachmentRef | null>(null);
  const [preview, setPreview] = useState<AttachmentRef | null>(null);
  const images = attachments.filter((a) => a.kind === "image");
  const files = attachments.filter((a) => a.kind !== "image");
  return (
    <div className="mb-1 flex flex-col items-end gap-1.5">
      {images.length > 0 && (
        <div className="flex max-w-full flex-wrap justify-end gap-1.5">
          {images.map((image) => (
            <button
              key={image.uploadId}
              type="button"
              onClick={() => setEnlarged(image)}
              className="border-border overflow-hidden rounded-xl border transition-transform active:scale-95"
              aria-label={`Enlarge ${image.name}`}
            >
              <img
                src={botsApi.uploadUrl(image.uploadId)}
                alt={image.name}
                className="max-h-40 max-w-56 object-cover"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="flex max-w-full flex-wrap justify-end gap-1.5">
          {files.map((file) => (
            <FileChip key={file.uploadId} file={file} onOpen={() => setPreview(file)} />
          ))}
        </div>
      )}
      <FilePreviewDialog file={preview} onClose={() => setPreview(null)} />
      {/* Portalled: a message row has content-visibility:auto, which makes it the
          containing block for position:fixed, so an inline overlay was clipped
          to the row (#165). */}
      {enlarged &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
            role="dialog"
            aria-label={`Image ${enlarged.name}`}
            onClick={() => setEnlarged(null)}
          >
            <img
              src={botsApi.uploadUrl(enlarged.uploadId)}
              alt={enlarged.name}
              className="max-h-full max-w-full rounded-lg object-contain"
            />
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-4 right-4 rounded-full text-white"
              aria-label="Close image"
              onClick={() => setEnlarged(null)}
            >
              <X className="size-5" />
            </Button>
            <a
              href={botsApi.uploadUrl(enlarged.uploadId)}
              download={enlarged.name}
              className="absolute bottom-4 right-4"
            >
              <Button variant="secondary" size="sm">
                <Download className="size-4" /> Download
              </Button>
            </a>
          </div>,
          document.body,
        )}
    </div>
  );
}
