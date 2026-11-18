/**
 * Dividers that let you give a side panel more or less room on wide screens:
 * the right panel beside a thread (or a PR review's assistant beside its
 * diff), and a review's file list on the left of its diff. Drag one, or
 * focus it and use the arrow keys (Shift for bigger steps, Home and End for
 * the limits). Each width is remembered in this browser on its own; a
 * double-click or Enter goes back to the default.
 */
import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { cn } from "@groot/ui/lib/utils";

const STEP = 16;
const BIG_STEP = 64;

/** How one panel may be sized, and where its width is remembered. */
interface PanelLimits {
  key: string;
  /** Which side of its divider the panel sits. */
  side: "left" | "right";
  min: number;
  /** At most this wide, whatever the room. */
  max?: number;
  /** What the content on the divider's other side always keeps. */
  keep: number;
}

/** The right panel: a thread's conversation keeps 360px. */
const REVIEW_PANEL: PanelLimits = {
  key: "code:review-width",
  side: "right",
  min: 320,
  keep: 360,
};
/** A review's file list: 200px to 640px, and the diff keeps 360px. */
const FILE_LIST: PanelLimits = {
  key: "code:files-width",
  side: "left",
  min: 200,
  max: 640,
  keep: 360,
};

function readWidth(key: string): number | null {
  try {
    const stored = Number(window.localStorage.getItem(key));
    return stored > 0 ? stored : null;
  } catch {
    return null;
  }
}

function saveWidth(key: string, width: number | null) {
  try {
    if (width === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, String(Math.round(width)));
  } catch {
    // not remembered in private mode
  }
}

/** A panel's chosen width in px, or null for its default. */
function useStoredWidth(key: string) {
  const [width, setWidth] = useState(() => readWidth(key));
  const change = useCallback(
    (next: number | null, persist: boolean) => {
      setWidth(next);
      if (persist) saveWidth(key, next);
    },
    [key],
  );
  return [width, change] as const;
}

/**
 * The right panel with its divider. Dragged to a width, the panel keeps it
 * (shrinking only as far as its minimum when the window narrows); otherwise
 * it takes about half.
 */
export function ResizablePane({
  children,
  narrow = false,
  className,
}: {
  children: ReactNode;
  className?: string;
  /** Start narrower than half (a PR review's assistant, beside the diff). */
  narrow?: boolean;
}) {
  const [width, setWidth] = useStoredWidth(REVIEW_PANEL.key);
  const panelRef = useRef<HTMLElement>(null);
  return (
    <>
      <PanelResizer
        limits={REVIEW_PANEL}
        label="Resize review panel"
        controls="code-review-panel"
        className="lg:block"
        panelRef={panelRef}
        width={width}
        onWidth={setWidth}
      />
      <section
        ref={panelRef}
        id="code-review-panel"
        aria-label="Review panel"
        className={cn(
          "flex w-full min-w-0 flex-col",
          width === null
            ? narrow
              ? "lg:w-[36%] lg:max-w-xl"
              : "lg:w-[48%] lg:max-w-3xl"
            : "lg:w-(--review-width) lg:min-w-80",
          className,
        )}
        style={width === null ? undefined : ({ "--review-width": `${width}px` } as CSSProperties)}
      >
        {children}
      </section>
    </>
  );
}

/**
 * A review's list of changed files, left of its diff, with its divider (from
 * `md`, where the two sit side by side). Below that the list sits above the
 * diff at full width.
 */
export function FileListPane({ children }: { children: ReactNode }) {
  const [width, setWidth] = useStoredWidth(FILE_LIST.key);
  const panelRef = useRef<HTMLElement>(null);
  return (
    <>
      <nav
        ref={panelRef}
        id="code-review-files"
        aria-label="Changed files"
        className={cn(
          "border-border flex max-h-56 min-h-0 shrink-0 flex-col border-b md:max-h-none md:border-b-0",
          width === null ? "md:w-72" : "md:w-(--files-width)",
        )}
        style={width === null ? undefined : ({ "--files-width": `${width}px` } as CSSProperties)}
      >
        {children}
      </nav>
      <PanelResizer
        limits={FILE_LIST}
        label="Resize file list"
        controls="code-review-files"
        className="md:block"
        panelRef={panelRef}
        width={width}
        onWidth={setWidth}
      />
    </>
  );
}

function PanelResizer({
  limits,
  label,
  controls,
  className,
  panelRef,
  width,
  onWidth,
}: {
  limits: PanelLimits;
  label: string;
  /** The panel's id. */
  controls: string;
  /** From which breakpoint the divider shows, such as `lg:block`. */
  className: string;
  /** The panel being resized; its parent row bounds how wide it may grow. */
  panelRef: RefObject<HTMLElement | null>;
  width: number | null;
  onWidth(width: number | null, persist: boolean): void;
}) {
  const [dragging, setDragging] = useState(false);
  const { min, keep, side } = limits;
  // The panel and what sits past the divider share the room they have now.
  const bounds = () => {
    const panel = panelRef.current;
    const other =
      side === "right"
        ? panel?.previousElementSibling?.previousElementSibling
        : panel?.nextElementSibling?.nextElementSibling;
    const shared = (panel?.offsetWidth ?? 0) + ((other as HTMLElement | null)?.offsetWidth ?? 0);
    const room = Math.max(min, (shared || window.innerWidth) - keep);
    const max = Math.min(limits.max ?? room, room);
    return { max, current: width ?? panel?.offsetWidth ?? min };
  };
  const clamp = (value: number, max: number) => Math.round(Math.min(max, Math.max(min, value)));
  // Moving the divider right grows a panel on its left and shrinks one on its right.
  const grow = side === "left" ? 1 : -1;
  const { max, current } = bounds();
  const now = clamp(current, max);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const { max: limit, current: start } = bounds();
    const startX = event.clientX;
    let latest = clamp(start, limit);
    setDragging(true);
    const move = (e: globalThis.PointerEvent) => {
      latest = clamp(start + grow * (e.clientX - startX), limit);
      onWidth(latest, false);
    };
    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
      setDragging(false);
      onWidth(latest, true);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? BIG_STEP : STEP;
    const next =
      event.key === "ArrowLeft"
        ? now - grow * step
        : event.key === "ArrowRight"
          ? now + grow * step
          : event.key === "Home"
            ? min
            : event.key === "End"
              ? max
              : event.key === "Enter"
                ? null
                : undefined;
    if (next === undefined) return;
    event.preventDefault();
    onWidth(next === null ? null : clamp(next, max), true);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-controls={controls}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={now}
      tabIndex={0}
      title="Drag to resize, double-click to reset"
      data-dragging={dragging || undefined}
      onPointerDown={startDrag}
      onDoubleClick={() => onWidth(null, true)}
      onKeyDown={onKeyDown}
      className={cn(
        "group bg-border relative z-10 hidden w-px shrink-0 cursor-col-resize touch-none outline-none select-none before:absolute before:inset-y-0 before:-left-1.5 before:w-3 before:content-['']",
        className,
      )}
    >
      <span
        aria-hidden
        className="bg-muted-foreground/50 pointer-events-none absolute top-1/2 left-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[dragging]:opacity-100"
      />
    </div>
  );
}
