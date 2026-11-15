import { useRef, useState, type DragEvent, type RefObject } from "react";
import { Paperclip } from "lucide-react";
import type { ChatComposerHandle } from "../ChatComposer";

/**
 * Drop files anywhere on the conversation to attach them. dragenter and
 * dragleave fire for every child crossed, so a depth counter tells when
 * the pointer really left the pane.
 */
export function useFileDrop(enabled: boolean, composerRef: RefObject<ChatComposerHandle | null>) {
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const isFileDrag = (e: DragEvent) => e.dataTransfer.types.includes("Files");
  const dropHandlers = enabled
    ? {
        onDragEnter: (e: DragEvent) => {
          if (!isFileDrag(e)) return;
          e.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        },
        onDragOver: (e: DragEvent) => {
          if (!isFileDrag(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        },
        onDragLeave: (e: DragEvent) => {
          if (!isFileDrag(e)) return;
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        },
        onDrop: (e: DragEvent) => {
          if (!isFileDrag(e)) return;
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          if (e.dataTransfer.files.length > 0)
            composerRef.current?.stageFiles(e.dataTransfer.files);
        },
      }
    : {};
  return { dragging, dropHandlers };
}

export function DropOverlay() {
  return (
    <div
      className="border-ring bg-background/80 text-foreground pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed text-sm font-medium backdrop-blur-sm"
      data-testid="drop-overlay"
    >
      <Paperclip className="text-muted-foreground size-6" />
      Drop files to attach
    </div>
  );
}
