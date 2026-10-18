import { useState } from "react";
import { Check, ChevronDown, Copy, Loader2, Wrench } from "lucide-react";
import { Streamdown } from "streamdown";
import { cn } from "@groot/shell/lib/utils";
import type { ChatMessage } from "../lib/chat-types";
import { BotAvatar } from "./BotAvatar";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="text-muted-foreground hover:text-foreground absolute top-0 right-0 opacity-0 transition-opacity group-hover:opacity-100"
      aria-label="Copy message"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function Reasoning({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
      >
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        Reasoning
      </button>
      {open && (
        <p className="text-muted-foreground mt-1.5 border-l-2 pl-3 text-xs whitespace-pre-wrap">
          {text}
        </p>
      )}
    </div>
  );
}

interface ChatMessageViewProps {
  message: ChatMessage;
  botName: string;
  botEmoji: string | null;
  botColor: string;
}

const TOOL_LABELS: Record<string, string> = {
  create_task: "Added task",
  list_tasks: "Listed tasks",
  update_task: "Updated task",
  complete_task: "Completed task",
  delete_task: "Deleted task",
};

/** Compact status chips above the reply (PRD §15: "✓ Adding task …"). */
function ToolChips({ calls }: { calls: { name: string; summary: string }[] }) {
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {calls.map((call, i) => (
        <span
          key={i}
          className="bg-muted text-muted-foreground inline-flex max-w-[16rem] items-center gap-1 rounded-full px-2 py-0.5 text-xs"
          title={`${call.name}${call.summary ? ` — ${call.summary}` : ""}`}
        >
          <Wrench className="size-3 shrink-0" />
          <span className="truncate">
            {TOOL_LABELS[call.name] ?? call.name}
            {call.summary ? ` ${call.summary}` : ""}
          </span>
        </span>
      ))}
    </div>
  );
}

/**
 * One transcript row. User messages are right-aligned muted bubbles;
 * assistant replies render full-width markdown with the bot avatar and no
 * bubble (PRD §6.2). Compaction entries become a subtle divider marker.
 */
export function ChatMessageView({ message, botName, botEmoji, botColor }: ChatMessageViewProps) {
  if (message.role === "marker") {
    return (
      <div className="my-4 flex items-center gap-3" role="separator">
        <div className="grow border-t border-dashed" />
        <span className="text-muted-foreground text-xs">Earlier messages summarized</span>
        <div className="grow border-t border-dashed" />
      </div>
    );
  }

  if (message.role === "user") {
    const failed = message.status === "unanswered";
    return (
      <div className="group flex justify-end">
        <div className="relative max-w-[85%]">
          <CopyButton text={message.text} />
          <div
            className={cn(
              "rounded-2xl rounded-br-sm px-3.5 py-2 text-sm",
              failed ? "bg-destructive/15 text-destructive" : "bg-muted text-foreground",
            )}
          >
            <p className="whitespace-pre-wrap">{message.text}</p>
          </div>
          {failed && <p className="text-destructive mt-1 text-right text-xs">{message.error}</p>}
        </div>
      </div>
    );
  }

  const streaming = message.status === "streaming";
  return (
    <div className="group flex gap-3">
      <BotAvatar
        name={botName}
        emoji={botEmoji}
        color={botColor}
        className="mt-0.5 size-7 text-xs"
      />
      <div className="relative min-w-0 flex-1">
        <CopyButton text={message.text} />
        {message.toolCalls && message.toolCalls.length > 0 && (
          <ToolChips calls={message.toolCalls} />
        )}
        {message.reasoning && <Reasoning text={message.reasoning} />}
        <div className="min-w-0 text-sm">
          <Streamdown>{message.text || (streaming ? "" : message.text)}</Streamdown>
          {streaming && !message.text && (
            <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
              <Loader2 className="size-3 animate-spin" />
              thinking…
            </span>
          )}
          {message.status === "error" && (
            <p className="text-destructive mt-1 text-xs">
              {message.error ?? "The model returned an error."}
            </p>
          )}
          {message.status === "stopped" && (
            <p className="text-muted-foreground mt-1 text-xs">Stopped</p>
          )}
          {message.status === "unanswered" && (
            <p className="text-destructive mt-1 text-xs">{message.error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
