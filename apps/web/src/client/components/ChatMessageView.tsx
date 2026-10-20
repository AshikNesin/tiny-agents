import { useState } from "react";
import { Ban, Check, Clock, Copy, ExternalLink, MessagesSquare, Sparkles } from "lucide-react";
import { Streamdown } from "streamdown";
import { Button } from "@groot/ui/button";
import { toast } from "sonner";
import { botsApi } from "../lib/bots-api";
import type { ChatMessage, ChatToolCall } from "../lib/chat-types";
import { BotAvatar } from "./BotAvatar";
import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "./ui/code-block";
import { useHighlightedCode } from "./ui/hooks/use-highlighted-code";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "./ui/trace";
import { Bubble, BubbleContent } from "./ui/bubble";
import { MessageAttachments } from "./Attachments";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "./ui/item";
import { Message } from "./ui/message";
import { parsePeerEnvelope, type PeerEnvelope } from "@tiny-agents/agent/peer-envelope";
import type { Bot } from "../lib/bots-api";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="text-muted-foreground hover:text-foreground absolute top-0 right-0 opacity-0 transition-opacity group-hover:opacity-100"
      aria-label="Copy message"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          toast.error("Copy failed");
        }
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

/** Thinking block: an AI Elements Reasoning step — open while streaming. */
function Reasoning({ text, running }: { text: string; running: boolean }) {
  const [open, setOpen] = useState(running);
  return (
    <TraceCollapsible open={open} onOpenChange={setOpen} className="mb-2">
      <TraceCollapsibleTrigger>
        <TraceLine>
          <TraceTitle>Reasoning</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <p className="whitespace-pre-wrap">{text}</p>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

/** Short argument phrase for a tool row (“Fix SSE”, “pi-durable”). */
function summarizeArgs(call: ChatToolCall): string {
  const args = call.args ?? {};
  for (const key of ["title", "query", "url", "name", "id", "to", "text"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 60);
  }
  const first = Object.values(args)[0];
  return typeof first === "string" ? first.slice(0, 60) : "";
}

const STATUS_TEXT: Partial<Record<ChatToolCall["status"], string>> = {
  awaiting_approval: "waiting for your approval",
  interrupted: "interrupted by a restart",
  aborted: "stopped",
  denied: "denied by you",
};

function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.max(1, Math.round(ms))}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** Map our tool status onto the trace step status. */
function traceStatus(status: ChatToolCall["status"]): "running" | "error" | "pending" | undefined {
  switch (status) {
    case "running":
    case "pending":
      return "running";
    case "error":
    case "denied":
    case "aborted":
    case "interrupted":
      return "error";
    case "awaiting_approval":
      return "pending";
    case "done":
      return undefined;
  }
}

function statusIcon(call: ChatToolCall) {
  switch (call.status) {
    case "awaiting_approval":
      return <Clock className="text-primary size-3.5" />;
    case "denied":
    case "aborted":
    case "interrupted":
      return <Ban className="size-3.5" />;
    default:
      return undefined;
  }
}

/** The approval card: an AI Elements Confirmation built on Item. */
function ApprovalCard({
  call,
  label,
  botId,
  botName,
}: {
  call: ChatToolCall;
  label: string;
  botId: string;
  botName: string;
}) {
  const [busy, setBusy] = useState(false);
  const decide = async (decision: "approved" | "denied", alwaysAllow?: string) => {
    if (busy || call.taskId === undefined) return;
    setBusy(true);
    try {
      await botsApi.decideApproval(botId, call.taskId, decision, alwaysAllow);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to answer");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Item className="border-primary/40 bg-primary/5 my-1 max-w-lg">
      <ItemContent>
        <ItemTitle>
          {botName} wants to {label.toLowerCase()}
          {summarizeArgs(call) ? ` — “${summarizeArgs(call)}”` : ""}
        </ItemTitle>
        <ItemDescription>Nothing runs until you answer.</ItemDescription>
      </ItemContent>
      <ItemActions className="flex flex-col items-stretch gap-1.5">
        <Button size="xs" disabled={busy} onClick={() => decide("denied")}>
          Deny
        </Button>
        <Button size="xs" variant="outline" disabled={busy} onClick={() => decide("approved")}>
          Approve
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={busy}
          onClick={() => decide("approved", call.name)}
          title={`Approve and stop asking about ${label}`}
        >
          Always allow
        </Button>
      </ItemActions>
    </Item>
  );
}

/** One shiki-highlighted JSON block for a tool call's Input or Output. */
function ToolDetailBlock({
  title,
  value,
  destructive = false,
}: {
  title: string;
  value: string;
  destructive?: boolean;
}) {
  const lines = useHighlightedCode(value, "json");
  return (
    <CodeBlock size="sm" variant={destructive ? "destructive" : "default"}>
      <CodeBlockHeader>
        <CodeBlockTitle>{title}</CodeBlockTitle>
      </CodeBlockHeader>
      <CodeBlockContent wrap className="max-h-64">
        {lines.map((line, i) => (
          <CodeBlockLine key={i}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  );
}

/**
 * One tool call as an AI Elements Tool step: a TraceLine with the call's
 * status, expanding to its arguments and result. Awaiting calls show the
 * approval card instead (issue #1 D3/D4).
 */
function ToolRow({
  call,
  label,
  botId,
  botName,
}: {
  call: ChatToolCall;
  label: string;
  botId: string;
  botName: string;
}) {
  const summary = summarizeArgs(call);
  const extra = STATUS_TEXT[call.status];
  const argsJson = JSON.stringify(call.args, null, 2);
  const detail =
    call.output || argsJson !== "{}" ? (
      <div className="flex flex-col gap-2">
        {argsJson !== "{}" && <ToolDetailBlock title="Input" value={argsJson} />}
        {call.output && (
          <ToolDetailBlock
            title="Output"
            value={call.output}
            destructive={
              call.status === "error" ||
              call.status === "denied" ||
              call.status === "aborted" ||
              call.status === "interrupted"
            }
          />
        )}
        {call.sources && call.sources.length > 0 && (
          <Trace>
            {call.sources.map((source) => (
              <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
                <TraceLine>
                  <TraceIcon>
                    <ExternalLink />
                  </TraceIcon>
                  <TraceTitle>{source.title}</TraceTitle>
                </TraceLine>
              </a>
            ))}
          </Trace>
        )}
      </div>
    ) : null;

  if (call.status === "awaiting_approval" && call.taskId !== undefined) {
    return <ApprovalCard call={call} label={label} botId={botId} botName={botName} />;
  }

  // message_bot row: the Grok handoff pill — the peer's avatar, their name,
  // and the outbound snippet.
  if (call.name === "message_bot") {
    const to = typeof call.args?.to === "string" ? call.args.to : "";
    const snippet =
      typeof call.args?.text === "string"
        ? call.args.text.replace(/\s+/g, " ").trim().slice(0, 60)
        : "";
    return (
      <Trace className="gap-1">
        <TraceLine status={traceStatus(call.status)} data-testid="bot-handoff">
          <TraceIcon>
            <BotAvatar name={to} className="size-4" />
          </TraceIcon>
          <TraceTitle>
            {call.status === "running" || call.status === "pending" ? "Messaging" : "Messaged"}{" "}
            {to || "bot"}
          </TraceTitle>
          {snippet && <TraceDescription>“{snippet}”</TraceDescription>}
          {call.durationMs !== undefined && (
            <TraceDescription>{formatDuration(call.durationMs)}</TraceDescription>
          )}
        </TraceLine>
      </Trace>
    );
  }

  const line = (
    <TraceLine status={traceStatus(call.status)}>
      {statusIcon(call) ? <TraceIcon>{statusIcon(call)}</TraceIcon> : null}
      <TraceTitle>
        {call.name === "load_skill" ? (
          <span className="inline-flex items-center gap-1">
            <Sparkles className="size-3" />
            Using skill {summary}
          </span>
        ) : (
          label
        )}
        {summary && call.name !== "load_skill" ? ` “${summary}”` : ""}
      </TraceTitle>
      {(extra || call.approval === "approved") && (
        <TraceDescription>
          {extra}
          {extra && call.approval === "approved" ? " · approved by you" : ""}
        </TraceDescription>
      )}
      {call.durationMs !== undefined && (
        <TraceDescription>{formatDuration(call.durationMs)}</TraceDescription>
      )}
    </TraceLine>
  );

  return (
    <Trace className="gap-1">
      {detail ? (
        <TraceCollapsible>
          <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
          <TraceCollapsibleContent className="space-y-2">{detail}</TraceCollapsibleContent>
        </TraceCollapsible>
      ) : (
        line
      )}
    </Trace>
  );
}

/** Label lookup for tool names, from the capability catalog. */
export type ToolLabels = Record<string, string>;

export function toolLabel(labels: ToolLabels, name: string): string {
  if (labels[name]) return labels[name];
  const via = name.match(/^mcp__([a-z0-9-]+)__(.+)$/);
  if (via) {
    const pretty = via[2].replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return `${pretty} via ${via[1]}`;
  }
  return name.replace(/_/g, " ");
}

export interface ChatMessageViewProps {
  message: ChatMessage;
  botName: string;
  botId?: string;
  toolLabels?: ToolLabels;
}

/**
 * One transcript row. User messages are right-aligned bubbles (AI Elements
 * Message + Bubble); assistant replies render full-width markdown with the
 * bot avatar and no bubble (PRD §6.2). Tool calls are Trace steps above the
 * reply; a call waiting for approval renders its Confirmation card.
 * Compaction entries become a divider marker.
 */
export function ChatMessageView({
  message,
  botName,
  botId,
  toolLabels = {},
}: ChatMessageViewProps) {
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
    const envelope = parsePeerEnvelope(message.text);
    if (envelope) {
      return (
        <PeerCard
          envelope={envelope}
          failed={failed}
          error={message.error}
          streaming={message.status === "streaming"}
        />
      );
    }
    return (
      <Message align="end" className="group">
        {/* content-visibility on the scroller item breaks percentage
            max-widths, so the bubble is capped by the flex parent chain
            instead of a nested wrapper. */}
        <div className="relative max-w-[min(85%,48rem)]">
          <CopyButton text={message.text} />
          {message.attachments && message.attachments.length > 0 && (
            <MessageAttachments attachments={message.attachments} />
          )}
          {message.text && (
            <Bubble align="end" variant="muted" className="max-w-full">
              <BubbleContent className="rounded-2xl px-4 py-2.5 text-[15px]">
                <p className="whitespace-pre-wrap">{message.text}</p>
              </BubbleContent>
            </Bubble>
          )}
          {failed && <p className="text-destructive mt-1 text-right text-xs">{message.error}</p>}
        </div>
      </Message>
    );
  }

  return assistantView(message, { botName, botId, toolLabels });
}

/** One peer-traffic user message as a Grok-style attributed card. */
function PeerCard({
  envelope,
  failed,
  error,
  streaming,
}: {
  envelope: PeerEnvelope;
  failed: boolean;
  error?: string;
  streaming: boolean;
}) {
  if (envelope.kind === "mention") {
    // The owner tagged this bot from {host}'s chat: the owner's own words
    // in a labeled muted bubble.
    return (
      <Message align="end" className="group">
        <div className="relative max-w-[min(85%,48rem)]">
          <CopyButton text={envelope.text} />
          <p className="text-muted-foreground px-1 pb-0.5 text-right text-xs">
            You · in {envelope.hostName}&apos;s chat
          </p>
          <Bubble align="end" variant="muted" className="max-w-full">
            <BubbleContent className="rounded-2xl px-4 py-2.5 text-[15px]">
              <p className="whitespace-pre-wrap">{envelope.text}</p>
            </BubbleContent>
          </Bubble>
          {failed && <p className="text-destructive mt-1 text-right text-xs">{error}</p>}
        </div>
      </Message>
    );
  }
  if (envelope.kind === "message") {
    // A bot messaged this bot via message_bot: attributed incoming card.
    return <PeerIncomingCard name={envelope.name} text={envelope.text} streaming={streaming} />;
  }
  // A relayed reply into the asker's chat: attributed incoming card with a
  // relayed marker.
  return (
    <PeerIncomingCard name={envelope.name} text={envelope.text} relayed streaming={streaming} />
  );
}

/**
 * Incoming card for bot-to-bot traffic: peer avatar + name header (the
 * Grok handoff pattern) with the payload below; full-width like assistant
 * replies, never painted as the owner's bubble. `relayed` marks a reply
 * that the relay delivered back into the asker's chat.
 */
export function PeerIncomingCard({
  name,
  text,
  relayed = false,
  streaming = false,
}: {
  name: string;
  text: string;
  relayed?: boolean;
  streaming?: boolean;
}) {
  return (
    <Message
      className="group gap-3"
      data-testid="peer-card"
      data-peer={name}
      data-relayed={relayed ? "true" : undefined}
    >
      <BotAvatar name={name} className="mt-1 size-8" />
      <div className="relative min-w-0 flex-1">
        <CopyButton text={text} />
        <p className="text-muted-foreground mb-1 flex items-center gap-1.5 px-1 text-xs">
          <MessagesSquare className="size-3" aria-hidden />
          <span className="text-foreground/80 font-medium">{name}</span>
          <span aria-hidden>·</span>
          <span>{relayed ? "reply relayed into this chat" : "messaged you"}</span>
        </p>
        <div
          data-slot="reply-card"
          className="bg-secondary/50 rounded-2xl rounded-tl-md px-4 py-3 text-[15px] leading-relaxed"
        >
          <Streamdown>{text}</Streamdown>
        </div>
        {streaming && (
          <span className="text-muted-foreground mt-1 inline-flex items-center gap-1.5 px-1 text-xs">
            <span className="bg-muted-foreground/60 size-1.5 animate-pulse rounded-full" />
            replying…
          </span>
        )}
      </div>
    </Message>
  );
}

function assistantView(
  message: ChatMessage,
  ctx: { botName: string; botId?: string; toolLabels: ToolLabels },
) {
  const { botName, botId, toolLabels } = ctx;
  const streaming = message.status === "streaming";
  // Terminal status notices render inside the reply card, so a failed or
  // stopped turn with no text still surfaces its notice.
  const hasNotice =
    message.status === "error" || message.status === "stopped" || message.status === "unanswered";
  return (
    <Message className="group gap-3">
      <BotAvatar name={botName} className="mt-1 size-8" />
      <div className="relative min-w-0 flex-1">
        <CopyButton text={message.text} />
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mb-2 space-y-1">
            {message.toolCalls.map((call, i) => (
              <ToolRow
                key={`${call.id}-${i}-${call.name}`}
                call={call}
                label={toolLabel(toolLabels, call.name)}
                botId={botId ?? ""}
                botName={botName}
              />
            ))}
          </div>
        )}
        {message.reasoning && <Reasoning text={message.reasoning} running={streaming} />}
        {/* Reply card: a rounded surface with generous padding. Renders only
            when there is something to show — text, or a terminal status notice.
            A tool-only turn (empty text, not streaming) shows just its trace
            rows; rendering the card anyway painted an empty box. */}
        {(message.text || (hasNotice && !streaming)) && (
          <div
            data-slot="reply-card"
            className="bg-secondary/50 rounded-2xl px-4 py-3 text-[15px] leading-relaxed"
          >
            <Streamdown>{message.text}</Streamdown>
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
        )}
        {streaming && !message.text && (
          <span className="text-muted-foreground inline-flex items-center gap-1.5 px-1 text-xs">
            <span className="bg-muted-foreground/60 size-1.5 animate-pulse rounded-full" />
            thinking…
          </span>
        )}
      </div>
    </Message>
  );
}
