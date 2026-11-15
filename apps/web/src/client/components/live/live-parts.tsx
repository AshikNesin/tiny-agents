/** What the panel and the page draw alike over and around the viewer. */
import type { ReactNode } from "react";
import { Hand, LoaderCircle } from "lucide-react";
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
