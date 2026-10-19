/** Attachment UI (issue #17): composer staging chips and transcript rendering. */
import { useState } from "react";
import { Download, FileText, ImageIcon, Loader2, X } from "lucide-react";
import { Button } from "@groot/ui/button";
import { botsApi, type AttachmentRef } from "../lib/bots-api";

function humanSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

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
            title={attachment.name}
          >
            {attachment.name}
          </span>
        </div>
      )}
      {uploading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/60">
          <Loader2 className="size-5 animate-spin" />
        </div>
      )}
      {failed && (
        <div
          className="text-destructive absolute inset-0 flex items-center justify-center bg-background/80 p-1 text-center text-[10px]"
          title={attachment.error}
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

export type StagedItem = {
  key: string;
  name: string;
  status: "uploading" | "done" | "error";
  error?: string;
  previewUrl?: string;
  /** Set when done. */
  ref?: AttachmentRef;
};

/** Attachments on a transcript user message: thumbnails and file chips. */
export function MessageAttachments({ attachments }: { attachments: AttachmentRef[] }) {
  const [enlarged, setEnlarged] = useState<AttachmentRef | null>(null);
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
            <a
              key={file.uploadId}
              href={botsApi.uploadUrl(file.uploadId)}
              download={file.name}
              className="bg-secondary/60 hover:bg-secondary flex max-w-64 items-center gap-2 rounded-full px-3 py-1.5 text-xs"
              title={`${file.name} (${humanSize(file.size)})`}
            >
              <FileText className="text-muted-foreground size-3.5 shrink-0" />
              <span className="truncate">{file.name}</span>
              <span className="text-muted-foreground shrink-0">{humanSize(file.size)}</span>
              <Download className="text-muted-foreground size-3 shrink-0" />
            </a>
          ))}
        </div>
      )}
      {enlarged && (
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
        </div>
      )}
    </div>
  );
}
