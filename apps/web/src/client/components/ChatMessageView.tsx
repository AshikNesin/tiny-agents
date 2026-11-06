import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@groot/ui/lib/utils";
import {
  Ban,
  Check,
  Clock,
  Copy,
  ExternalLink,
  Hand,
  KeyRound,
  ListChecks,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Streamdown } from "streamdown";
import { markdownComponents } from "../lib/markdown";
import { Button } from "@groot/ui/button";
import { toast } from "sonner";
import type { ChatMessage, ChatToolCall } from "../lib/chat-types";
import { isActive, viewOf } from "../lib/tool-call-view";
import {
  approvalNote,
  approvalText,
  credentialRequestText,
  durationText,
  groupText,
  stepTitle,
  toolSteps,
  vaultApprovalText,
  type ToolLabelCatalog,
  type ToolLabels,
} from "../lib/tool-call-text";
import {
  type OwnerActions,
  showComputerPanel,
  useOwnerActions,
  useOwnerDecision,
} from "../lib/owner-actions";
import { BotAvatar } from "./BotAvatar";
import { BotHandoff } from "./BotHandoff";
import { CodeHandoffCard } from "./CodeHandoffCard";
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
import { MessageAttachments } from "./Attachments";
import { ownerText } from "../lib/attachment-notes";
import { AskedQuestions, QuestionCard } from "./QuestionCard";
import { OTHER_PILL, TypingIndicator, USER_PILL } from "./ui/transcript-parts";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "./ui/item";
import { Message } from "./ui/message";
import { stripPeerEnvelope } from "@tiny-agents/agent/peer-envelope";
import { useAuthStore } from "@groot/shell/store/auth";

/** "14:05" today, "Mon 14:05" this week, "12 Oct, 14:05" before; the full date in the tooltip. */
function messageTime(at: number, now = Date.now()): { short: string; full: string } {
  const date = new Date(at);
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const full = date.toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" });
  const sameDay = new Date(now).toDateString() === date.toDateString();
  if (sameDay) return { short: time, full };
  if (now - at < 6 * 24 * 60 * 60_000) {
    return { short: `${date.toLocaleDateString(undefined, { weekday: "short" })} ${time}`, full };
  }
  const day = date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return { short: `${day}, ${time}`, full };
}

/**
 * Round hover actions beside a bubble: when it was sent, and copy. Always
 * visible on touch, where there is no hover.
 */
function CopyButton({ text, at }: { text: string; at?: number }) {
  const stamp = at ? messageTime(at) : undefined;
  return (
    <div className="flex shrink-0 flex-col items-center gap-0.5">
      <CopyAction text={text} />
      {stamp && (
        <time
          dateTime={new Date(at!).toISOString()}
          title={stamp.full}
          className="text-muted-foreground text-[11px] leading-none whitespace-nowrap opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100"
        >
          {stamp.short}
        </time>
      )}
    </div>
  );
}

/**
 * Fluid ChatMessage's meta row under a message: when it was sent, and copy.
 * It keeps its height so revealing it never shifts the transcript; hidden
 * until the message is hovered or focused, and always shown on touch.
 */
function MessageMeta({
  text,
  at,
  align = "start",
}: {
  text: string;
  at?: number;
  align?: "start" | "end";
}) {
  const stamp = at ? messageTime(at) : undefined;
  return (
    <div
      data-slot="message-meta"
      className={cn(
        "-mt-0.5 flex h-6 items-center gap-1.5 px-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100",
        align === "end" && "flex-row-reverse",
      )}
    >
      <CopyAction text={text} />
      {stamp && (
        <time
          dateTime={new Date(at!).toISOString()}
          title={stamp.full}
          className="text-muted-foreground text-xs tabular-nums whitespace-nowrap"
        >
          {stamp.short}
        </time>
      )}
    </div>
  );
}

/**
 * Fluid ChatMessage's entrance: a message that just arrived rises 8px and
 * scales up from its bubble corner. History already on screen when the
 * transcript renders (or remounts while scrolling) stays still.
 */
function MessageEnter({
  fresh,
  align,
  className,
  children,
}: {
  fresh: boolean;
  align: "start" | "end";
  className?: string;
  children: ReactNode;
}) {
  const [animate] = useState(fresh);
  const reduceMotion = useReducedMotion() ?? false;
  return (
    <motion.div
      className={className}
      initial={animate && !reduceMotion ? { opacity: 0, y: 8, scale: 0.96 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", duration: 0.16, bounce: 0 }}
      style={{ transformOrigin: align === "end" ? "bottom right" : "bottom left" }}
    >
      {children}
    </motion.div>
  );
}

/** Arrived within the last few seconds (or is being streamed now). */
function isFresh(message: ChatMessage): boolean {
  if (message.status === "streaming") return true;
  return Boolean(message.createdAt) && Date.now() - message.createdAt < 5_000;
}

function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-6 shrink-0 items-center justify-center rounded-full opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
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

const STATUS_ICONS = {
  clock: <Clock className="text-primary size-3.5" />,
  ban: <Ban className="size-3.5" />,
};

/**
 * The approval card: an AI Elements Confirmation built on Item. `ask` is the
 * imperative phrase completing "<bot> wants to …" (issue #85).
 */
function ApprovalCard({
  call,
  labels,
  actions,
  botName,
}: {
  call: ChatToolCall & { taskId: number };
  labels: ToolLabelCatalog;
  actions: OwnerActions;
  botName: string;
}) {
  const { busy, run } = useOwnerDecision("Failed to answer");
  const [showFull, setShowFull] = useState(false);
  const decide = (decision: "approved" | "denied", alwaysAllow?: string) =>
    run(() => actions.decideApproval(call.taskId, decision, { alwaysAllow }));
  const text = approvalText(call, botName, labels);
  return (
    <Item className="border-primary/40 bg-primary/5 my-1 max-w-lg">
      <ItemContent>
        <ItemTitle>{text.title}</ItemTitle>
        {text.foldedPayload !== undefined ? (
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => setShowFull((v) => !v)}
              className="text-muted-foreground hover:text-foreground text-xs font-medium underline underline-offset-4"
              aria-expanded={showFull}
            >
              {showFull ? "Read less" : "Read more"}
            </button>
            {showFull && (
              <pre className="bg-muted max-h-64 overflow-auto rounded-md p-2 font-mono text-xs whitespace-pre-wrap">
                {text.foldedPayload}
              </pre>
            )}
          </div>
        ) : null}
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
          title={text.alwaysAllowHint}
        >
          Always allow
        </Button>
      </ItemActions>
    </Item>
  );
}

/** A vault use's approval (issue #56): the item and where it goes, never the value. */
function VaultApprovalCard({
  call,
  actions,
  botName,
}: {
  call: ChatToolCall & { taskId: number; vault: NonNullable<ChatToolCall["vault"]> };
  actions: OwnerActions;
  botName: string;
}) {
  const { busy, run } = useOwnerDecision("Failed to answer");
  const decide = (decision: "approved" | "denied", grant?: boolean) =>
    run(() => actions.decideApproval(call.taskId, decision, { grant }));
  const text = vaultApprovalText(call, botName);
  return (
    <Item className="border-primary/40 bg-primary/5 my-1 max-w-lg">
      <ItemContent>
        <ItemTitle>
          <KeyRound className="size-4" />
          {text.title}
        </ItemTitle>
        {text.command !== undefined && (
          <pre className="bg-muted max-h-40 overflow-auto rounded-md p-2 font-mono text-xs whitespace-pre-wrap">
            {text.command}
          </pre>
        )}
        <ItemDescription>{text.description}</ItemDescription>
      </ItemContent>
      <ItemActions className="flex flex-col items-stretch gap-1.5">
        <Button size="xs" disabled={busy} onClick={() => decide("denied")}>
          Deny
        </Button>
        <Button size="xs" variant="outline" disabled={busy} onClick={() => decide("approved")}>
          Approve once
        </Button>
        {call.vault.grantable && (
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={() => decide("approved", true)}
            title={text.grantHint}
          >
            For this chat
          </Button>
        )}
      </ItemActions>
    </Item>
  );
}

/** A credential request (issue #56): opens the sheet where the owner types. */
function CredentialRequestCard({
  call,
  botName,
}: {
  call: ChatToolCall & { credentials: NonNullable<ChatToolCall["credentials"]> };
  botName: string;
}) {
  const text = credentialRequestText(call, botName);
  return (
    <Item className="border-primary/40 bg-primary/5 my-1 max-w-lg">
      <ItemContent>
        <ItemTitle>
          <KeyRound className="size-4" />
          {text.title}
        </ItemTitle>
        <ItemDescription>{text.description}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button size="xs" asChild>
          <Link to={`/vault/requests/${call.taskId}`}>Open</Link>
        </Button>
      </ItemActions>
    </Item>
  );
}

/**
 * The bot asked the owner to take over its computer (issue #108): Grok's
 * "Action needed" card. The computer is already the owner's; the card
 * brings the live view up and hands it back.
 */
function TakeoverCard({
  call,
  actions,
  botName,
}: {
  call: ChatToolCall & { takeover: NonNullable<ChatToolCall["takeover"]> };
  actions: OwnerActions;
  botName: string;
}) {
  const { busy, run } = useOwnerDecision("Failed to hand the computer back", { settle: false });
  return (
    <Item className="border-primary/40 bg-primary/5 my-1 max-w-lg" data-testid="takeover-card">
      <ItemContent>
        <ItemTitle>
          <Hand className="size-4" />
          {botName} needs you on the computer
        </ItemTitle>
        <ItemDescription>
          {call.takeover.reason} You have control; {botName} waits and takes no screenshots until
          you are done.
        </ItemDescription>
      </ItemContent>
      <ItemActions className="flex flex-col items-stretch gap-1.5">
        <Button size="xs" onClick={showComputerPanel}>
          Open computer
        </Button>
        {actions.handBackComputer && (
          <Button
            size="xs"
            variant="outline"
            disabled={busy}
            onClick={() => run(() => actions.handBackComputer!())}
          >
            I'm done
          </Button>
        )}
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
      <CodeBlockContent
        wrap
        className="max-h-64 overflow-y-auto overscroll-contain [scrollbar-width:auto] [scrollbar-gutter:stable]"
      >
        {lines.map((line, i) => (
          <CodeBlockLine key={i}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  );
}

/**
 * One tool call: the card `viewOf` picks for it (an approval card while it
 * waits, issue #1 D3/D4; a bot's questions for the owner; a hand-off), else
 * an AI Elements Tool step: a TraceLine with the call's status, expanding to
 * its arguments and result.
 */
function ToolRow({
  call,
  labels,
  botName,
}: {
  call: ChatToolCall;
  labels: ToolLabelCatalog;
  botName: string;
}) {
  // No owner actions: a Past chat (issue #101), where what still waits can
  // no longer be answered.
  const actions = useOwnerActions();
  const view = viewOf(call, { readOnly: !actions });
  const contentRef = useRef<HTMLDivElement | null>(null);
  const argsJson = JSON.stringify(call.args, null, 2);
  const detail =
    call.output || argsJson !== "{}" ? (
      <div className="flex flex-col gap-2">
        {argsJson !== "{}" && <ToolDetailBlock title="Input" value={argsJson} />}
        {call.output && (
          <ToolDetailBlock
            title="Output"
            value={call.output}
            destructive={view.phase === "failed"}
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

  // A card is picked only with what it needs (owner actions, a task id, the
  // call's details), so the assertions below hold. data-waiting: what a
  // notification's ?focus= link scrolls to (focus-param.ts).
  switch (view.card) {
    case "vault-approval":
      return (
        <div data-waiting={view.anchor}>
          <VaultApprovalCard
            call={{ ...call, taskId: call.taskId!, vault: call.vault! }}
            actions={actions!}
            botName={botName}
          />
        </div>
      );
    case "approval":
      return (
        <div data-waiting={view.anchor}>
          <ApprovalCard
            call={{ ...call, taskId: call.taskId! }}
            labels={labels}
            actions={actions!}
            botName={botName}
          />
        </div>
      );
    case "credentials":
      return (
        <CredentialRequestCard
          call={{ ...call, credentials: call.credentials! }}
          botName={botName}
        />
      );
    case "takeover":
      return (
        <div data-waiting={view.anchor}>
          <TakeoverCard
            call={{ ...call, takeover: call.takeover! }}
            actions={actions!}
            botName={botName}
          />
        </div>
      );
    // ask_owner: the questionnaire while it waits, then the questions and answers.
    case "question":
      return (
        <div data-waiting={view.anchor}>
          <QuestionCard
            call={{ ...call, taskId: call.taskId!, questions: call.questions! }}
            actions={actions!}
            botName={botName}
          />
        </div>
      );
    case "asked-questions":
      return <AskedQuestions call={call} note={view.note} />;
    // message_bot row: Grok's centered handoff line that opens the thread.
    case "bot-handoff":
      return <BotHandoff call={call} botName={botName} />;
    // code_start / shelley_start (issue #143): the coding hand-off, linking to the Code page.
    case "code-handoff":
      return <CodeHandoffCard handoff={call.code!} />;
  }

  const title = stepTitle(call, labels);
  const note = approvalNote(view.note, call.approval);
  const duration = durationText(call);
  const line = (
    <TraceLine status={view.trace}>
      {view.icon ? <TraceIcon>{STATUS_ICONS[view.icon]}</TraceIcon> : null}
      <TraceTitle>
        {call.name === "load_skill" ? (
          <span className="inline-flex items-center gap-1">
            <Sparkles className="size-3" />
            {title}
          </span>
        ) : (
          title
        )}
      </TraceTitle>
      {note !== undefined && <TraceDescription>{note}</TraceDescription>}
      {duration !== undefined && <TraceDescription>{duration}</TraceDescription>}
    </TraceLine>
  );

  return (
    <Trace className="gap-1">
      {detail ? (
        <TraceCollapsible
          onOpenChange={(open) => {
            // Expanding mid-transcript must bring the detail into view
            // (friction #38): with long histories the opened block can be
            // hundreds of px off-screen, which reads as "click did nothing".
            if (!open) return;
            requestAnimationFrame(() =>
              contentRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
            );
          }}
        >
          <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
          <TraceCollapsibleContent className="space-y-2">
            <div ref={contentRef}>{detail}</div>
          </TraceCollapsibleContent>
        </TraceCollapsible>
      ) : (
        line
      )}
    </Trace>
  );
}

/** Finished tool calls folded into one line, as on the Code page; each call inside. */
function ToolGroupRow({
  calls,
  labels,
  botName,
}: {
  calls: ChatToolCall[];
  labels: ToolLabelCatalog;
  botName: string;
}) {
  const text = groupText(calls, labels);
  return (
    <Trace data-testid="tool-group">
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <ListChecks />
            </TraceIcon>
            <TraceTitle>{text.title}</TraceTitle>
            {text.failed !== undefined && (
              <TraceDescription className="text-destructive">{text.failed}</TraceDescription>
            )}
            {text.duration !== undefined && <TraceDescription>{text.duration}</TraceDescription>}
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="space-y-1">
          {calls.map((call, i) => (
            <ToolRow
              key={`${call.id}-${i}-${call.name}`}
              call={call}
              labels={labels}
              botName={botName}
            />
          ))}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

export interface ChatMessageViewProps {
  message: ChatMessage;
  botName: string;
  /** Tool name → past-tense label for transcript rows ("Opened a page"). */
  toolLabels?: ToolLabels;
  /** Tool name → imperative label for approval cards ("open a page"). */
  toolAskLabels?: ToolLabels;
}

/**
 * One transcript row. User messages are right-aligned dark pills; assistant
 * replies are left-aligned light cards with markdown (PRD §6.2). Tool calls are Trace steps above the
 * reply; a call waiting for approval renders its Confirmation card, acting
 * through the `OwnerActions` in scope (none in a Past chat: no actions).
 * Compaction entries become a divider marker.
 */
export function ChatMessageView({
  message,
  botName,
  toolLabels = {},
  toolAskLabels = {},
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
    // Trusted attribution only (entry metadata set by the delivery pipeline):
    // a typed text that merely looks like an envelope renders as a plain
    // bubble, so no one can forge a peer card (cubic: spoofing).
    const peer = message.peer;
    if (peer) {
      return (
        <PeerCard
          peer={peer}
          text={stripPeerEnvelope(message.text)}
          failed={failed}
          error={message.error}
          streaming={message.status === "streaming"}
        />
      );
    }
    const text = ownerText(message.text, Boolean(message.attachments?.length));
    return <UserMessage message={message} text={text} failed={failed} />;
  }

  return assistantView(message, { botName, toolLabels, toolAskLabels });
}

/**
 * A person's message. Yours sits on the right; in a shared chat (issue #145)
 * someone else's sits on the left under their name, like a group chat.
 */
function UserMessage({
  message,
  text,
  failed,
}: {
  message: ChatMessage;
  text: string;
  failed: boolean;
}) {
  const me = useAuthStore((s) => s.user?.id);
  const other = message.author !== undefined && message.author.id !== me;
  const align = other ? "start" : "end";
  return (
    <Message align={align} className="group" data-author={message.author?.name}>
      {/* content-visibility on the scroller item breaks percentage
          max-widths, so the pill is capped by the flex parent chain
          instead of a nested wrapper. */}
      <MessageEnter
        fresh={isFresh(message)}
        align={align}
        className={`flex max-w-[92%] md:max-w-[80%] min-w-0 flex-col gap-1 ${other ? "items-start" : "items-end"}`}
      >
        {other && (
          <p className="text-muted-foreground flex items-center gap-1.5 px-1 text-xs">
            <span className="bg-muted text-foreground/80 flex size-4 items-center justify-center rounded-full text-[10px] font-semibold">
              {message.author!.name[0]?.toUpperCase()}
            </span>
            <span className="text-foreground/80 font-medium">{message.author!.name}</span>
          </p>
        )}
        {message.attachments && message.attachments.length > 0 && (
          <MessageAttachments attachments={message.attachments} />
        )}
        {text && (
          <div className={other ? OTHER_PILL : USER_PILL}>
            <p className="whitespace-pre-wrap">{text}</p>
          </div>
        )}
        {failed && (
          <p className={`text-destructive text-xs ${other ? "" : "text-right"}`}>{message.error}</p>
        )}
        {text && <MessageMeta text={text} at={message.createdAt || undefined} align={align} />}
      </MessageEnter>
    </Message>
  );
}

/** One peer-traffic user message as a Grok-style attributed card. */
function PeerCard({
  peer,
  text,
  failed,
  error,
  streaming,
}: {
  peer: NonNullable<ChatMessage["peer"]>;
  text: string;
  failed: boolean;
  error?: string;
  streaming: boolean;
}) {
  if (peer.kind === "mention") {
    // The owner tagged this bot from {host}'s chat: the owner's own words
    // in a labeled muted bubble.
    return (
      <Message align="end" className="group">
        <div className="flex max-w-[92%] md:max-w-[80%] min-w-0 flex-col items-end gap-1">
          <p className="text-muted-foreground px-1 text-right text-xs">
            You · in {peer.hostName}&apos;s chat
          </p>
          <div className="flex max-w-full min-w-0 items-center gap-2">
            <CopyButton text={text} />
            <div className={USER_PILL}>
              <p className="whitespace-pre-wrap">{text}</p>
            </div>
          </div>
          {failed && <p className="text-destructive text-right text-xs">{error}</p>}
        </div>
      </Message>
    );
  }
  if (peer.kind === "message") {
    // A bot messaged this bot via message_bot: attributed incoming card.
    return (
      <PeerIncomingCard
        name={peer.name}
        text={text}
        failed={failed}
        error={error}
        streaming={streaming}
      />
    );
  }
  // A relayed reply into the asker's chat: attributed incoming card with a
  // relayed marker.
  return (
    <PeerIncomingCard
      name={peer.name}
      text={text}
      relayed
      failed={failed}
      error={error}
      streaming={streaming}
    />
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
  failed = false,
  error,
  streaming = false,
}: {
  name: string;
  text: string;
  relayed?: boolean;
  failed?: boolean;
  error?: string;
  streaming?: boolean;
}) {
  return (
    <Message
      className="group flex-col gap-1.5"
      data-testid="peer-card"
      data-peer={name}
      data-relayed={relayed ? "true" : undefined}
    >
      <p className="text-muted-foreground flex items-center justify-center gap-1.5 py-1 text-xs">
        <BotAvatar name={name} className="size-4" />
        <span className="text-foreground/80 font-medium">{name}</span>
        <span aria-hidden>·</span>
        <span>{relayed ? "reply relayed into this chat" : "messaged you"}</span>
      </p>
      <div className="flex min-w-0 items-center gap-2">
        <div
          data-slot="reply-card"
          className="bg-bubble chat-md min-w-0 max-w-[92%] md:max-w-[80%] rounded-3xl px-4 py-2"
        >
          <Streamdown components={markdownComponents}>{text}</Streamdown>
        </div>
        <CopyButton text={text} />
      </div>
      {streaming && <TypingIndicator label="replying" />}
      {failed && (
        <p className="text-destructive px-1 text-xs">
          {error ?? "This delivery was not answered."}
        </p>
      )}
    </Message>
  );
}

function assistantView(
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
