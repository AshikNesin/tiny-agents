import { useState } from "react";
import { ChevronDown, MessageSquare, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, monoClass } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { Spinner } from "../../components/ui/spinner";
import { errorMessage } from "../../lib/errors";
import { useCommentStore, useThreadComments } from "../../lib/code/comments";
import { projectsApi } from "../../lib/code/projects";

export function PendingComments({
  threadId,
  enabled = true,
  onShow,
  sendNow: canSendNow = true,
}: {
  threadId: string;
  enabled?: boolean;
  onShow?(): void;
  sendNow?: boolean;
}) {
  const comments = useThreadComments(threadId, enabled);
  const remove = useCommentStore((s) => s.remove);
  const sent = useCommentStore((s) => s.sent);
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  if (comments.length === 0) return null;

  const sendNow = async () => {
    setSending(true);
    try {
      const result = await projectsApi.sendDrafts(threadId);
      sent(threadId);
      toast.success(
        `Sent ${result.sent} ${result.sent === 1 ? "comment" : "comments"} to the agent.`,
      );
    } catch (error) {
      toast.error(errorMessage(error, "Could not send the comments."));
    } finally {
      setSending(false);
    }
  };

  const count = comments.length;
  return (
    <section
      aria-label="Comments for the agent"
      className="bg-muted/60 rounded-xl text-sm"
      data-testid="code-pending-comments"
    >
      <div className="flex items-center gap-1.5 py-1 pr-1 pl-3">
        <MessageSquare className="text-muted-foreground size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {count} {count === 1 ? "comment goes" : "comments go"} with your next message
        </span>
        <Button
          size="xs"
          variant="ghost"
          aria-expanded={open}
          aria-label={open ? "Hide comments" : "Show comments"}
          onClick={() => setOpen((o) => !o)}
          className="text-muted-foreground"
        >
          <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
        </Button>
        {canSendNow && (
          <Button size="xs" variant="outline" onClick={() => void sendNow()} disabled={sending}>
            {sending ? <Spinner className="size-3" /> : <Send />}
            Send now
          </Button>
        )}
      </div>
      {open && (
        <ul className="border-border max-h-48 space-y-0.5 overflow-y-auto border-t px-1.5 py-1.5">
          {comments.map((c) => (
            <li key={c.id} className="flex items-start gap-2 rounded-md px-1.5 py-0.5 text-xs">
              <button
                type="button"
                onClick={onShow}
                disabled={!onShow}
                title={onShow ? "Show in Changes" : undefined}
                className={cn("text-muted-foreground shrink-0 enabled:hover:underline", monoClass)}
              >
                {c.path}:{c.startLine === c.endLine ? c.startLine : `${c.startLine}-${c.endLine}`}
              </button>
              <span className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
                {c.body}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Remove comment"
                className="text-muted-foreground -my-0.5"
                onClick={() =>
                  void remove(threadId, c.id).catch((error: unknown) =>
                    toast.error(errorMessage(error, "Could not remove it.")),
                  )
                }
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
