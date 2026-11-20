import { Paperclip, X } from "lucide-react";
import { Button } from "@groot/ui/button";
import type { OutboxEntry } from "../../lib/chat-session";

export function QueuedMessages({
  held,
  onWithdraw,
}: {
  held: OutboxEntry[];
  onWithdraw: (requestId: string) => void;
}) {
  return (
    <ul
      className="mx-auto flex w-full max-w-[784px] flex-col items-end gap-1 px-4 pt-2 md:px-5"
      aria-label="Waiting to send"
    >
      {held.map((item) => (
        <QueuedMessageView
          key={`queued-${item.requestId}`}
          item={item}
          onCancel={() => onWithdraw(item.requestId)}
        />
      ))}
    </ul>
  );
}

function QueuedMessageView({ item, onCancel }: { item: OutboxEntry; onCancel: () => void }) {
  const files = item.attachments?.length ?? 0;
  const steering = item.state === "steering";
  return (
    <li
      data-testid="queued-bubble"
      data-mode={steering ? "steer" : "followUp"}
      className="bg-muted/60 flex max-w-[85%] min-w-0 items-center gap-2 rounded-2xl py-1 pr-1 pl-3 text-sm"
    >
      <span className="text-muted-foreground shrink-0 text-xs">
        {steering ? "Steering" : "Queued"}
      </span>
      <span className="min-w-0 flex-1 truncate" title={item.text}>
        {item.text}
      </span>
      {files > 0 && (
        <span className="text-muted-foreground flex shrink-0 items-center gap-0.5 text-xs">
          <Paperclip className="size-3" />
          {files}
        </span>
      )}
      <Button
        size="icon-xs"
        variant="ghost"
        onClick={onCancel}
        aria-label="Cancel this message"
        title={steering ? "Joins the running reply · cancel" : "Sent after this reply · cancel"}
      >
        <X />
      </Button>
    </li>
  );
}
