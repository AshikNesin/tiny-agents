import { useState } from "react";
import { ArrowLeftRight, ChevronRight, Lock } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@groot/ui/dialog";
import { cn } from "@groot/ui/lib/utils";
import type { ChatToolCall } from "../lib/chat-types";
import { BotAvatar } from "./BotAvatar";

function handoffLabel(status: ChatToolCall["status"]): string {
  if (status === "running" || status === "pending") return "Messaging";
  if (status === "done") return "Messaged";
  if (status === "denied") return "Blocked message to";
  if (status === "aborted") return "Stopped messaging";
  if (status === "interrupted") return "Interrupted message to";
  return "Failed to message";
}

const FAILED: ReadonlySet<ChatToolCall["status"]> = new Set([
  "error",
  "denied",
  "aborted",
  "interrupted",
]);

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** A sender label (avatar + name) above a bordered bubble, as in Grok's thread view. */
function ThreadMessage({ name, text }: { name: string; text: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-sm">
        <BotAvatar name={name} className="size-6" />
        <span className="font-medium">{name}</span>
      </div>
      <div className="bg-bubble border-border/60 max-w-[92%] rounded-3xl border px-4 py-2.5 text-[15px] leading-[22.5px] wrap-break-word whitespace-pre-wrap">
        {text}
      </div>
    </div>
  );
}

/**
 * The outbound `message_bot` call as Grok's centered handoff line: a quiet
 * pill (avatar, "Messaged {bot}", a snippet) that opens the full message in a
 * view-only thread dialog. The bot's reply arrives later in the transcript as
 * a relayed peer card, so the dialog only shows what was sent.
 */
export function BotHandoff({ call, botName }: { call: ChatToolCall; botName: string }) {
  const [open, setOpen] = useState(false);
  const to = typeof call.args?.to === "string" ? call.args.to : "";
  const text = typeof call.args?.text === "string" ? call.args.text : "";
  const snippet = text.replace(/\s+/g, " ").trim().slice(0, 60);
  const failed = FAILED.has(call.status) || call.status === "error";
  const running = call.status === "running" || call.status === "pending";

  return (
    <>
      <div className="flex justify-center py-1">
        <button
          type="button"
          data-testid="bot-handoff"
          onClick={() => setOpen(true)}
          disabled={!text}
          className={cn(
            "hover:bg-accent focus-visible:ring-ring/50 inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs outline-none focus-visible:ring-2 disabled:pointer-events-none",
            failed ? "text-destructive" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <BotAvatar name={to} className="size-4 shrink-0" />
          <span className={cn("shrink-0 font-medium", running && "animate-pulse")}>
            {handoffLabel(call.status)} {to || "bot"}
          </span>
          {snippet && <span className="min-w-0 truncate opacity-70">“{snippet}”</span>}
          {call.durationMs !== undefined && (
            <span className="shrink-0 opacity-70">{formatDuration(call.durationMs)}</span>
          )}
          {text && <ChevronRight className="size-3 shrink-0 opacity-60" aria-hidden />}
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] gap-0 overflow-hidden p-0 sm:max-w-xl">
          <div className="border-border/60 flex items-center gap-2 border-b px-6 py-4 pr-14">
            <BotAvatar name={botName} className="size-5" />
            <DialogTitle className="text-sm font-medium">{botName}</DialogTitle>
            <ArrowLeftRight className="text-muted-foreground size-3.5" aria-hidden />
            <BotAvatar name={to} className="size-5" />
            <span className="text-sm font-medium">{to}</span>
          </div>
          <DialogDescription className="sr-only">
            The message {botName} sent to {to}.
          </DialogDescription>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
            <ThreadMessage name={botName} text={text} />
            {failed && (
              <p className="text-destructive text-xs">
                {call.output || "This message was not delivered."}
              </p>
            )}
          </div>
          <div className="text-muted-foreground border-border/60 flex items-center justify-center gap-1.5 border-t px-6 py-3 text-xs">
            <Lock className="size-3" aria-hidden />
            This chat is view-only
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
