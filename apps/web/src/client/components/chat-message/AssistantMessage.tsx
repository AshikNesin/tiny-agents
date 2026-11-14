/**
 * An assistant turn: its tool calls, its reasoning, and the reply card with
 * any terminal status notice.
 */
import { useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { markdownComponents } from "../../lib/markdown";
import type { ChatMessage } from "../../lib/chat-types";
import { isActive } from "../../lib/tool-call-view";
import { toolSteps, type ToolLabelCatalog, type ToolLabels } from "../../lib/tool-call-text";
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceLine,
  TraceTitle,
} from "../ui/trace";
import { TypingIndicator } from "../ui/transcript-parts";
import { Message } from "../ui/message";
import { MessageEnter, MessageMeta, isFresh } from "./message-chrome";
import { ToolGroupRow, ToolRow } from "./ToolRow";

/**
 * Thinking block: an AI Elements Reasoning step. Open (and shimmering)
 * while the model reasons, folded away once it finishes so the reply is
 * what remains on screen.
 */
function Reasoning({ text, running }: { text: string; running: boolean }) {
  const [open, setOpen] = useState(running);
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current !== running) setOpen(running);
    wasRunning.current = running;
  }, [running]);
  return (
    <TraceCollapsible open={open} onOpenChange={setOpen} className="mb-2">
      <TraceCollapsibleTrigger>
        <TraceLine status={running ? "running" : undefined}>
          <TraceTitle>{running ? "Thinking…" : "Reasoning"}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <p className="whitespace-pre-wrap">{text}</p>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

export function assistantView(
  message: ChatMessage,
  ctx: {
    botName: string;
    toolLabels: ToolLabels;
    toolAskLabels: ToolLabels;
  },
) {
  const { botName } = ctx;
  const labels: ToolLabelCatalog = { done: ctx.toolLabels, ask: ctx.toolAskLabels };
  const streaming = message.status === "streaming";
  // Terminal status notices render inside the reply card, so a failed or
  // stopped turn with no text still surfaces its notice.
  const hasNotice =
    message.status === "error" || message.status === "stopped" || message.status === "unanswered";
  return (
    <Message className="group">
      <div className="min-w-0 flex-1">
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mb-2 space-y-1">
            {toolSteps(message.toolCalls).map((step) =>
              step.kind === "group" ? (
                <ToolGroupRow
                  key={`group-${step.calls[0].id}-${step.i}`}
                  calls={step.calls}
                  labels={labels}
                  botName={botName}
                />
              ) : (
                <ToolRow
                  key={`${step.call.id}-${step.i}-${step.call.name}`}
                  call={step.call}
                  labels={labels}
                  botName={botName}
                />
              ),
            )}
          </div>
        )}
        {message.reasoning && <Reasoning text={message.reasoning} running={streaming} />}
        {/* Reply card: renders only when there is something to show — text,
            or a terminal status notice. A tool-only turn (empty text, not
            streaming) shows just its trace rows; rendering the card anyway
            painted an empty box. */}
        {(message.text || (hasNotice && !streaming)) && (
          <MessageEnter
            fresh={isFresh(message)}
            align="start"
            className="flex min-w-0 flex-col items-start gap-1"
          >
            <div
              data-slot="reply-card"
              data-variant="plain"
              className="chat-md min-w-0 max-w-full px-0.5 py-1 md:max-w-[88%]"
            >
              <Streamdown components={markdownComponents}>{message.text}</Streamdown>
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
            {message.text && !streaming && (
              <MessageMeta text={message.text} at={message.createdAt || undefined} />
            )}
          </MessageEnter>
        )}
        {/* Nothing visible yet: dots, unless a running tool row or the
            reasoning block already shows the bot at work. */}
        {streaming && !message.text && !message.reasoning && !message.toolCalls?.some(isActive) && (
          <TypingIndicator />
        )}
      </div>
    </Message>
  );
}
