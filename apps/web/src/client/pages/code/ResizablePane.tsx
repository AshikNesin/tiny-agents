/**
 * The divider between a thread and its right panel on wide screens: drag it,
 * or focus it and use the arrow keys (Shift for bigger steps, Home and End
 * for the limits), to give either side the room. The width is remembered in
 * this browser; a double-click or Enter goes back to the default split.
 * The conversation always keeps `MIN_THREAD` and the panel `MIN_PANEL`.
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

const WIDTH_KEY = "code:review-width";
const MIN_PANEL = 320;
const MIN_THREAD = 360;
const STEP = 16;
const BIG_STEP = 64;

function readWidth(): number | null {
  try {
    const stored = Number(window.localStorage.getItem(WIDTH_KEY));
    return stored > 0 ? stored : null;
  } catch {
    return null;
  }
}

function saveWidth(width: number | null) {
  try {
    if (width === null) window.localStorage.removeItem(WIDTH_KEY);
    else window.localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
  } catch {
    // not remembered in private mode
  }
}

/** The panel's chosen width in px, or null for the default split. */
function useReviewWidth() {
  const [width, setWidth] = useState(readWidth);
  const change = useCallback((next: number | null, persist: boolean) => {
    setWidth(next);
    if (persist) saveWidth(next);
  }, []);
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
  const [width, setWidth] = useReviewWidth();
  const panelRef = useRef<HTMLElement>(null);
  return (
    <>
      <PanelResizer panelRef={panelRef} width={width} onWidth={setWidth} />
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

function PanelResizer({
  panelRef,
  width,
  onWidth,
}: {
  /** The panel being resized; its parent row bounds how wide it may grow. */
  panelRef: RefObject<HTMLElement | null>;
  width: number | null;
  onWidth(width: number | null, persist: boolean): void;
}) {
  const [dragging, setDragging] = useState(false);
  // The panel and the conversation share what the row leaves after the thread list.
  const bounds = () => {
    const panel = panelRef.current;
    const thread = panel?.previousElementSibling?.previousElementSibling;
    const shared = (panel?.offsetWidth ?? 0) + ((thread as HTMLElement | null)?.offsetWidth ?? 0);
    const max = Math.max(MIN_PANEL, (shared || window.innerWidth) - MIN_THREAD);
    return { max, current: width ?? panel?.offsetWidth ?? MIN_PANEL };
  };
  const clamp = (value: number, max: number) =>
    Math.round(Math.min(max, Math.max(MIN_PANEL, value)));
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
      latest = clamp(start + (startX - e.clientX), limit);
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
        ? now + step
        : event.key === "ArrowRight"
          ? now - step
          : event.key === "Home"
            ? MIN_PANEL
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
      aria-label="Resize review panel"
      aria-controls="code-review-panel"
      aria-valuemin={MIN_PANEL}
      aria-valuemax={max}
      aria-valuenow={now}
      tabIndex={0}
      title="Drag to resize, double-click to reset"
      data-dragging={dragging || undefined}
      onPointerDown={startDrag}
      onDoubleClick={() => onWidth(null, true)}
      onKeyDown={onKeyDown}
      className="group bg-border relative z-10 hidden w-px shrink-0 cursor-col-resize touch-none outline-none select-none before:absolute before:inset-y-0 before:-left-1.5 before:w-3 before:content-[''] lg:block"
    >
      <span
        aria-hidden
        className="bg-muted-foreground/50 pointer-events-none absolute top-1/2 left-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[dragging]:opacity-100"
      />
    </div>
  );
}
