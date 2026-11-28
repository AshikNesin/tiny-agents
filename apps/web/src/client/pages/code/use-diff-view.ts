import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { readStored, writeStored } from "../../lib/browser-storage";

export type DiffStyle = "split" | "unified";

const STYLE_KEY = "code:diff-style";
const WIDE = "(min-width: 1024px)";

function readStyle(): DiffStyle {
  return readStored(STYLE_KEY) === "unified" ? "unified" : "split";
}

function useDiffStyle(): [DiffStyle, (style: DiffStyle) => void] {
  const [style, setStyle] = useState<DiffStyle>(readStyle);
  const change = useCallback((next: DiffStyle) => {
    setStyle(next);
    writeStored(STYLE_KEY, next);
  }, []);
  return [style, change];
}

function useWide(): boolean {
  return useSyncExternalStore(
    (change) => {
      if (typeof window.matchMedia !== "function") return () => undefined;
      const query = window.matchMedia(WIDE);
      query.addEventListener("change", change);
      return () => query.removeEventListener("change", change);
    },
    () => typeof window.matchMedia === "function" && window.matchMedia(WIDE).matches,
  );
}

export type CollapseAll = { all: boolean; at: number } | null;

export function useDiffView() {
  const [style, setStyle] = useDiffStyle();
  const wide = useWide();
  const [collapse, setCollapse] = useState<CollapseAll>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const drawer = useMemo(() => ({ open: filesOpen, onOpenChange: setFilesOpen }), [filesOpen]);
  return { style, setStyle, wide, collapse, setCollapse, drawer };
}

export type DiffView = ReturnType<typeof useDiffView>;
