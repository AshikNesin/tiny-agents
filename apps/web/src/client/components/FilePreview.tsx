/**
 * Attached files' live state and a read-only preview (issue #58). The
 * preview shows extracted text only — monospace text, a plain table for
 * sheets, a path list for archives — and never renders HTML, PDF or Office
 * content. The original stays a download.
 */
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { Button } from "@groot/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@groot/ui/dialog";
import { Table, TableBody, TableCell, TableRow } from "@groot/ui/table";
import { botsApi, type AttachmentRef, type UploadStatus, type UploadText } from "../lib/bots-api";

const POLL_MS = 2_000;
const MAX_POLLS = 90;

/** Poll an upload while it extracts; settles on ready, failed or unsupported. */
export function useUploadStatus(attachment: AttachmentRef): UploadStatus | undefined {
  const [status, setStatus] = useState<UploadStatus | undefined>(undefined);
  const id = attachment.uploadId;
  const isFile = attachment.kind === "file";
  useEffect(() => {
    if (!isFile) return;
    let cancelled = false;
    let polls = 0;
    const poll = async () => {
      if (++polls > MAX_POLLS) {
        window.clearInterval(timer);
        return;
      }
      try {
        const next = await botsApi.uploadStatus(id);
        if (cancelled) return;
        setStatus(next);
        if (next.status !== "pending") window.clearInterval(timer);
      } catch {
        // keep polling until the cap; the chip falls back to the size
      }
    };
    const timer = window.setInterval(() => void poll(), POLL_MS);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [id, isFile]);
  return status;
}

/** One short line for a chip: "extracting…", "40 pages", "failed: …". */
export function statusLabel(status: UploadStatus | undefined): string | undefined {
  if (!status) return undefined;
  if (status.status === "pending" || status.status === "none") return "extracting…";
  if (status.status === "failed") return "can't read";
  if (status.status === "unsupported") return "download only";
  const meta = status.meta ?? {};
  if (meta.format === "archive" && meta.entries !== undefined) return `${meta.entries} files`;
  if (meta.sheets) return `${meta.sheets} sheet${meta.sheets === 1 ? "" : "s"}`;
  if (meta.pages && meta.format !== "text" && meta.format !== "document") {
    return `${meta.pages} ${meta.format === "slides" ? "slide" : "page"}${meta.pages === 1 ? "" : "s"}`;
  }
  if (meta.lines) return `${meta.lines} lines`;
  return "ready";
}

/** Rows and cells with ids: a sheet's page is replaced whole, never reordered. */
function sheetCells(sheet: number, rows: string[][]) {
  return rows.map((row, r) => ({
    id: `${sheet}:${r}`,
    cells: row.map((text, c) => ({ id: `${sheet}:${r}:${c}`, text })),
  }));
}

function PreviewBody({ uploadId }: { uploadId: string }) {
  const [page, setPage] = useState(1);
  const [sheet, setSheet] = useState(1);
  const [data, setData] = useState<UploadText | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    botsApi
      .uploadText(uploadId, { page, sheet })
      .then((next) => !cancelled && setData(next))
      .catch(() => !cancelled && setError("The preview could not be loaded."));
    return () => {
      cancelled = true;
    };
  }, [uploadId, page, sheet]);

  if (error) return <p className="text-destructive text-sm">{error}</p>;
  if (!data) return <p className="text-muted-foreground text-sm">Loading…</p>;
  if (data.status !== "ready") {
    return (
      <p className="text-muted-foreground text-sm">
        {data.status === "pending" || data.status === "none"
          ? "Still extracting this file."
          : (data.error ?? "This file can't be previewed.")}
      </p>
    );
  }
  if ("entries" in data) {
    return (
      <ul className="max-h-[60vh] overflow-auto font-mono text-xs" aria-label="Archive contents">
        {data.entries.map((entry) => (
          <li key={entry.path} className="flex gap-3 py-0.5">
            <span className="min-w-0 flex-1 truncate">
              {entry.dir ? `${entry.path}/` : entry.path}
            </span>
            {entry.flag && <span className="text-warning shrink-0">{entry.flag}</span>}
          </li>
        ))}
      </ul>
    );
  }
  if ("rows" in data) {
    return (
      <div className="space-y-3">
        {data.sheets.length > 1 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sheets">
            {data.sheets.map((s, index) => (
              <Button
                key={s.name}
                size="sm"
                variant={index + 1 === data.sheet ? "default" : "outline"}
                onClick={() => setSheet(index + 1)}
              >
                {s.name}
                {s.hidden ? " (hidden)" : ""}
              </Button>
            ))}
          </div>
        )}
        <div className="max-h-[60vh] overflow-auto rounded-md border">
          <Table className="text-xs">
            <TableBody>
              {sheetCells(data.sheet, data.rows).map(({ id, cells }) => (
                <TableRow key={id}>
                  {cells.map((cell) => (
                    <TableCell key={cell.id} className="max-w-48 truncate" title={cell.text}>
                      {cell.text}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-muted-foreground text-xs">
          {Math.min(data.rows.length, data.totalRows)} of {data.totalRows} rows shown.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <pre className="bg-muted/40 max-h-[60vh] overflow-auto rounded-md p-3 font-mono text-xs whitespace-pre-wrap">
        {data.text || "(no text on this page)"}
      </pre>
      {data.pages > 1 && (
        <div className="flex items-center justify-between gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-muted-foreground text-xs">
            {data.label} · {data.page} of {data.pages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= data.pages}
            onClick={() => setPage((p) => p + 1)}
            aria-label="Next page"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

export function FilePreviewDialog({
  file,
  onClose,
}: {
  file: AttachmentRef | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={file !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        {file && (
          <>
            <DialogHeader>
              <DialogTitle className="truncate">{file.name}</DialogTitle>
              <DialogDescription>
                Extracted text only. Download the original to open it.
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <PreviewBody uploadId={file.uploadId} />
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" asChild>
                <a href={botsApi.uploadUrl(file.uploadId)} download={file.name}>
                  <Download className="size-4" /> Download
                </a>
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
