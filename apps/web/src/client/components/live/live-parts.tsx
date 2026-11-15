/** What the panel and the page draw alike over and around the viewer. */
import type { ReactNode } from "react";
import { Hand, LoaderCircle, MousePointerClick } from "lucide-react";
import { cn } from "@groot/ui/lib/utils";
import type { Connection } from "../../lib/live-view";
import type { VncState } from "../browser/VncView";

/** What a bot asked the owner to do on its desktop, while the owner drives. */
export function TakeoverBanner({
  testId,
  asked,
  reason,
  note,
}: {
  testId: string;
  asked: ReactNode;
  reason: string;
  note: string;
}) {
  return (
    <div
      className="flex shrink-0 items-start gap-2 border-b bg-primary/5 px-4 py-2 text-sm"
      data-testid={testId}
    >
      <Hand className="mt-0.5 size-4 shrink-0 text-primary" />
      <span className="min-w-0">
        <span className="font-medium">{asked}</span> {reason}{" "}
        <span className="text-muted-foreground">{note}</span>
      </span>
    </div>
  );
}

/** Over the viewer until it is live: connecting, or reconnecting. */
export function ConnectingOverlay({
  vncState,
  connecting,
}: {
  vncState: VncState;
  connecting: string;
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background/70 text-xs text-muted-foreground">
      <LoaderCircle className="size-3.5 animate-spin" />
      {vncState === "connecting" ? connecting : "Reconnecting…"}
    </div>
  );
}

/**
 * Over a view-only stream: the whole stream is the Take control button. A
 * pointer over it says so; a touch screen, which has no hover, always shows
 * the hint.
 */
export function TakeControlLayer({
  testId,
  title,
  onTake,
}: {
  testId: string;
  title: string;
  onTake: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onTake}
      aria-label="Take control"
      title={title}
      className="group absolute inset-0 flex cursor-pointer items-end justify-center pb-4 outline-none hover:bg-foreground/5 focus-visible:bg-foreground/5"
      data-testid={testId}
    >
      <span className="flex items-center gap-1.5 rounded-full bg-foreground/85 px-3 py-1.5 text-xs font-medium text-background opacity-0 shadow-lg backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 pointer-coarse:opacity-100">
        <MousePointerClick className="size-3.5" aria-hidden />
        Click to take control
      </span>
    </button>
  );
}

/** Around the stream while the owner drives it: theirs until they hand it back. */
export function DrivingFrame({ testId }: { testId: string }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 ring-2 ring-success ring-inset"
      data-testid={testId}
    />
  );
}

/**
 * One chip for the state that matters: who drives once the stream is live
 * (pulsing while it is the owner), otherwise the connection. The bar it sits
 * in is a container: when it is narrow the owner's chip is the pulsing dot
 * alone, since the frame and Hand back already say the stream is theirs.
 */
export function StatusChip({
  connection,
  live,
  yours,
  driver,
  testId,
  driverTestId,
}: {
  connection: Connection;
  live: boolean;
  /** The owner drives. */
  yours: boolean;
  /** Who drives, in words. */
  driver: string;
  testId?: string;
  driverTestId: string;
}) {
  const mine = live && yours;
  return (
    <span
      className={cn(
        "inline-flex h-6 min-w-0 shrink items-center gap-1.5 rounded-full px-2 text-xs font-medium",
        mine ? "bg-success/10 text-success" : "text-muted-foreground",
      )}
      aria-live="polite"
      data-testid={testId}
    >
      <span className="relative flex size-1.5 shrink-0" aria-hidden>
        {mine && (
          <span className="absolute inset-0 animate-ping rounded-full bg-success opacity-75" />
        )}
        <span
          className={cn("relative size-1.5 rounded-full", live ? "bg-success" : connection.dot)}
        />
      </span>
      {live ? (
        <span className={cn("truncate", mine && "@max-md:sr-only")} data-testid={driverTestId}>
          {driver}
        </span>
      ) : (
        <span className="truncate">{connection.label}</span>
      )}
    </span>
  );
}
