import { Columns2, FoldVertical, ListTree, Rows2, UnfoldVertical } from "lucide-react";
import { Button } from "@groot/ui";
import type { DiffView } from "./use-diff-view";

export function FilesButton({ view }: { view: DiffView }) {
  const { open, onOpenChange } = view.drawer;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="text-muted-foreground shrink-0 md:hidden"
      aria-label="Files"
      aria-expanded={open}
      onClick={() => onOpenChange(!open)}
    >
      <ListTree />
    </Button>
  );
}

export function DiffViewButtons({ view }: { view: DiffView }) {
  const { style, setStyle: onStyle, collapse, setCollapse: onCollapse } = view;
  const allFolded = collapse?.all ?? false;
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        aria-label={style === "split" ? "Switch to unified view" : "Switch to split view"}
        title={style === "split" ? "Unified view" : "Split view"}
        onClick={() => onStyle(style === "split" ? "unified" : "split")}
      >
        {style === "split" ? <Rows2 /> : <Columns2 />}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        aria-label={allFolded ? "Unfold all files" : "Fold all files"}
        title={allFolded ? "Unfold all files" : "Fold all files"}
        onClick={() => onCollapse({ all: !allFolded, at: Date.now() })}
      >
        {allFolded ? <UnfoldVertical /> : <FoldVertical />}
      </Button>
    </>
  );
}
