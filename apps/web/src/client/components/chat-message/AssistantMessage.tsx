import { useEffect, useRef, useState } from "react";
import { Markdown } from "../../lib/markdown";
import type { ChatMessage } from "../../lib/chat-types";
import { isActive } from "../../lib/tool-call-view";
import {
  toolSteps,
  workFold,
  type ToolLabelCatalog,
  type ToolLabels,
} from "../../lib/tool-call-text";
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceLine,
  TraceTitle,
} from "../ui/trace";
import { TypingIndicator } from "../ui/transcript-parts";
import { Message } from "../ui/message";
import { MessageEnter, MessageMeta, isFresh } from "./message-chrome";
import { ToolGroupRow, ToolRow } from "./ToolRow";

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
  const hasNotice =
    message.status === "error" || message.status === "stopped" || message.status === "unanswered";
  const folded = workFold(message, labels);
  const work = (
    <>
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
    </>
  );
  return (
    <Message className="group">
      <div className="min-w-0 flex-1">
        {folded ? (
          <TraceCollapsible className="mb-2" data-testid="reply-work">
            <TraceCollapsibleTrigger>
              <TraceLine>
                <TraceTitle>{folded.title}</TraceTitle>
                {folded.failed && (
                  <TraceDescription className="text-destructive">{folded.failed}</TraceDescription>
                )}
                {folded.duration && <TraceDescription>{folded.duration}</TraceDescription>}
              </TraceLine>
            </TraceCollapsibleTrigger>
            <TraceCollapsibleContent className="space-y-1 pt-1">{work}</TraceCollapsibleContent>
          </TraceCollapsible>
        ) : (
          work
        )}
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
              <Markdown streaming={streaming}>{message.text}</Markdown>
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
        {streaming && !message.text && !message.reasoning && !message.toolCalls?.some(isActive) && (
          <TypingIndicator />
        )}
      </div>
    </Message>
  );
}
