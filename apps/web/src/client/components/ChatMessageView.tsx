import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@groot/ui/lib/utils";
import { Ban, Check, Clock, Copy, ExternalLink, Hand, KeyRound, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { Streamdown } from "streamdown";
import { markdownComponents } from "../lib/markdown";
import { Button } from "@groot/ui/button";
import { toast } from "sonner";
import type { ChatMessage, ChatToolCall } from "../lib/chat-types";
import {
  type OwnerActions,
  showComputerPanel,
  useOwnerActions,
  useOwnerDecision,
} from "../lib/owner-actions";
import { BotAvatar } from "./BotAvatar";
import { BotHandoff } from "./BotHandoff";
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
import { ThinkingIndicator } from "./fluid/thinking-indicator";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "./ui/item";
import { Message } from "./ui/message";
import { stripPeerEnvelope } from "@tiny-agents/agent/peer-envelope";

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

/** The owner's bubble: Fluid ChatMessage's soft accent tint (tokens in app.css). */
export const USER_PILL =
  "bg-bubble-user text-bubble-user-foreground min-w-0 max-w-full rounded-2xl px-3.5 py-2 text-[15px] leading-[22.5px] wrap-break-word text-pretty";

const WORKING_WORDS = ["Thinking", "Working", "Planning", "Refining"] as const;
const REPLYING_WORDS = ["Replying"] as const;

/**
 * The bot is working but has nothing to show yet (waiting on the first token,
 * or between tool rounds): Fluid Functionalism's ThinkingIndicator, a glyph
 * morphing circle ⇄ infinity beside a shimmering status word.
 */
export function TypingIndicator({ label = "thinking" }: { label?: string }) {
  return (
    <ThinkingIndicator
      aria-label={`${label}…`}
      label={`${label}…`}
      words={label === "replying" ? REPLYING_WORDS : WORKING_WORDS}
      data-testid="typing-indicator"
      className="h-9 px-1 py-0"
    />
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

/** Short argument phrase for a tool row (“Fix SSE”, “pi-durable”). */
/** The payload behind an approval: `instructions`/`append` for a
 * self-improve change, else summarizeArgs' key. */
function approvalPayload(call: ChatToolCall): string {
  const args = call.args ?? {};
  for (const key of ["instructions", "append"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return summarizeArgs(call);
}

/** Beyond this many characters the approval card folds the payload behind
 * "Read more" — approving from a 60-char slice of a 700-word change is
 * rubber-stamping, and the one-line title can't hold it anyway. */
const PAYLOAD_FOLD = 120;

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
  awaiting_answer: "waiting for your answers",
  awaiting_credentials: "waiting for you to sign in",
  awaiting_takeover: "waiting for you on the computer",
  expired: "nobody answered in time",
  interrupted: "interrupted by a restart",
  aborted: "stopped",
  denied: "denied by you",
};

function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.max(1, Math.round(ms))}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** A human wait: "40s", "1m 40s", "2h 5m". */
function formatWait(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${Math.max(1, seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 ? `${minutes}m ${seconds % 60}s` : `${minutes}m`;
  return minutes % 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes / 60}h`;
}

/** Tool states whose row already shows the bot at work (or waiting on you). */
export const ACTIVE_TOOL_STATUSES: ReadonlySet<ChatToolCall["status"]> = new Set([
  "pending",
  "running",
  "awaiting_approval",
  "awaiting_answer",
  "awaiting_credentials",
  "awaiting_takeover",
]);

/** Map our tool status onto the trace step status. */
function traceStatus(status: ChatToolCall["status"]): "running" | "error" | "pending" | undefined {
  switch (status) {
    case "running":
    case "pending":
      return "running";
    case "error":
    case "denied":
    case "expired":
    case "aborted":
    case "interrupted":
      return "error";
    case "awaiting_approval":
    case "awaiting_answer":
    case "awaiting_credentials":
    case "awaiting_takeover":
      return "pending";
    case "done":
      return undefined;
  }
}

function statusIcon(call: ChatToolCall) {
  switch (call.status) {
    case "awaiting_approval":
    case "awaiting_answer":
    case "awaiting_credentials":
    case "awaiting_takeover":
      return <Clock className="text-primary size-3.5" />;
    case "denied":
    case "expired":
    case "aborted":
    case "interrupted":
      return <Ban className="size-3.5" />;
    default:
      return undefined;
  }
}

/**
 * The approval card: an AI Elements Confirmation built on Item. `ask` is the
 * imperative phrase completing "<bot> wants to …" (issue #85).
 */
function ApprovalCard({
  call,
  ask,
  actions,
  botName,
}: {
  call: ChatToolCall & { taskId: number };
  ask: string;
  actions: OwnerActions;
  botName: string;
}) {
  const { busy, run } = useOwnerDecision("Failed to answer");
  const [showFull, setShowFull] = useState(false);
  const decide = (decision: "approved" | "denied", alwaysAllow?: string) =>
    run(() => actions.decideApproval(call.taskId, decision, { alwaysAllow }));
  const summary = summarizeArgs(call);
  const payload = approvalPayload(call);
  const foldable = payload.length > PAYLOAD_FOLD;
  return (
    <Item className="border-primary/40 bg-primary/5 my-1 max-w-lg">
      <ItemContent>
        <ItemTitle>
          {botName} wants to {ask}
          {summary ? ` — “${summary.slice(0, 60)}${summary.length > 60 ? "…" : ""}”` : ""}
        </ItemTitle>
        {foldable ? (
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
                {payload}
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
          title={`Approve, and let ${botName} ${ask} without asking`}
        >
          Always allow
        </Button>
      </ItemActions>
    </Item>
  );
}

function minutesLeft(expiresAt: number | undefined): string | undefined {
  if (expiresAt === undefined) return undefined;
  const minutes = Math.max(0, Math.ceil((expiresAt - Date.now()) / 60_000));
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

const VAULT_VERB: Record<string, string> = {
  browser_fill_secret: "fill",
  browser_enter_code: "enter a code from",
  computer_fill_secret: "type",
  http_request: "send",
};

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
  const { vault } = call;
  const decide = (decision: "approved" | "denied", grant?: boolean) =>
    run(() => actions.decideApproval(call.taskId, decision, { grant }));
  const what = vault.card ? `${vault.card.brand} ••${vault.card.last4}` : vault.label;
  const verb = VAULT_VERB[vault.tool] ?? "use";
  const where = vault.tool === "http_request" ? `to ${vault.target}` : `on ${vault.target}`;
  const left = minutesLeft(call.expiresAt);
  const command = vault.tool === "run_command";
  return (
    <Item className="border-primary/40 bg-primary/5 my-1 max-w-lg">
      <ItemContent>
        <ItemTitle>
          <KeyRound className="size-4" />
          {command
            ? `${botName} wants to run a command with ${what}`
            : `${botName} wants to ${verb} ${what} ${where}`}
        </ItemTitle>
        {command && (
          <pre className="bg-muted max-h-40 overflow-auto rounded-md p-2 font-mono text-xs whitespace-pre-wrap">
            {vault.target}
          </pre>
        )}
        <ItemDescription>
          {command
            ? `${(vault.env ?? []).join(", ")} ${vault.env?.length === 1 ? "is" : "are"} set for this command only, and it can reach only ${vault.hosts?.join(", ") || "nothing"}. ${botName} never sees the value, but the command can use it: check what it does.`
            : `${vault.username ? `As ${vault.username}. ` : ""}The value goes straight ${vault.tool === "http_request" ? "into the request" : vault.tool === "computer_fill_secret" ? "into that window on the computer, and only if it is in front" : "into the page"}; ${botName} never sees it.`}
          {left ? ` Expires in ${left}.` : ""}
        </ItemDescription>
      </ItemContent>
      <ItemActions className="flex flex-col items-stretch gap-1.5">
        <Button size="xs" disabled={busy} onClick={() => decide("denied")}>
          Deny
        </Button>
        <Button size="xs" variant="outline" disabled={busy} onClick={() => decide("approved")}>
          Approve once
        </Button>
        {vault.grantable && (
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={() => decide("approved", true)}
            title={`Approve and stop asking about ${vault.handle} in this chat`}
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
  const { credentials } = call;
  let host = credentials.origin;
  try {
    host = new URL(credentials.origin).host;
  } catch {
    // keep the raw origin
  }
  const left = minutesLeft(call.expiresAt);
  return (
    <Item className="border-primary/40 bg-primary/5 my-1 max-w-lg">
      <ItemContent>
        <ItemTitle>
          <KeyRound className="size-4" />
          {botName} needs you on {host}
        </ItemTitle>
        <ItemDescription>
          {credentials.title}. What you type is filled into the page and never shown to {botName}.
          {left ? ` Expires in ${left}.` : ""}
        </ItemDescription>
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
 * One tool call as an AI Elements Tool step: a TraceLine with the call's
 * status, expanding to its arguments and result. Awaiting calls show the
 * approval card instead (issue #1 D3/D4), and a bot's questions for the
 * owner their questionnaire.
 */
function ToolRow({
  call,
  label,
  ask,
  botName,
}: {
  call: ChatToolCall;
  label: string;
  ask: string;
  botName: string;
}) {
  // No owner actions: a Past chat (issue #101), where what still waits can
  // no longer be answered.
  const actions = useOwnerActions();
  const readOnly = !actions;
  const summary = summarizeArgs(call);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const waiting = call.status.startsWith("awaiting_");
  const extra = readOnly && waiting ? "not answered" : STATUS_TEXT[call.status];
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
              call.status === "expired" ||
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

  // data-waiting: what a notification's ?focus= link scrolls to (focus-param.ts).
  if (actions && call.status === "awaiting_approval" && call.taskId !== undefined) {
    if (call.vault) {
      return (
        <div data-waiting={`approval:${call.taskId}`}>
          <VaultApprovalCard
            call={{ ...call, taskId: call.taskId, vault: call.vault }}
            actions={actions}
            botName={botName}
          />
        </div>
      );
    }
    return (
      <div data-waiting={`approval:${call.taskId}`}>
        <ApprovalCard
          call={{ ...call, taskId: call.taskId }}
          ask={ask}
          actions={actions}
          botName={botName}
        />
      </div>
    );
  }

  if (
    actions &&
    call.status === "awaiting_credentials" &&
    call.taskId !== undefined &&
    call.credentials
  ) {
    return (
      <CredentialRequestCard call={{ ...call, credentials: call.credentials }} botName={botName} />
    );
  }

  if (actions && call.status === "awaiting_takeover" && call.takeover) {
    return (
      <div data-waiting={call.taskId !== undefined ? `takeover:${call.taskId}` : undefined}>
        <TakeoverCard
          call={{ ...call, takeover: call.takeover }}
          actions={actions}
          botName={botName}
        />
      </div>
    );
  }

  // ask_owner: the questionnaire while it waits, then the questions and answers.
  if (call.questions) {
    if (actions && call.status === "awaiting_answer" && call.taskId !== undefined) {
      return (
        <div data-waiting={`question:${call.taskId}`}>
          <QuestionCard
            call={{ ...call, taskId: call.taskId, questions: call.questions }}
            actions={actions}
            botName={botName}
          />
        </div>
      );
    }
    const note = extra ?? (call.answers ? undefined : "dismissed by you");
    return <AskedQuestions call={call} note={note} />;
  }

  // message_bot row: Grok's centered handoff line that opens the thread.
  if (call.name === "message_bot") {
    return <BotHandoff call={call} botName={botName} />;
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
      {(extra || call.approval === "approved" || call.approval === "auto") && (
        <TraceDescription>
          {extra}
          {extra && call.approval === "approved" ? " · approved by you" : ""}
          {call.approval === "auto" ? `${extra ? " · " : ""}auto-approved` : ""}
        </TraceDescription>
      )}
      {call.durationMs !== undefined && (
        <TraceDescription>
          {formatDuration(call.durationMs)}
          {call.waitedMs ? ` · waited ${formatWait(call.waitedMs)} for you` : ""}
        </TraceDescription>
      )}
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

/**
 * What a tool call asks to do, completing "<bot> wants to …": the tool's
 * imperative label from the catalog, else "use <display name>" (connection
 * tools have no imperative label).
 */
export function toolAskLabel(askLabels: ToolLabels, labels: ToolLabels, name: string): string {
  return askLabels[name] ?? `use ${toolLabel(labels, name)}`;
}

export interface ChatMessageViewProps {
  message: ChatMessage;
  botName: string;
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
    return (
      <Message align="end" className="group">
        {/* content-visibility on the scroller item breaks percentage
            max-widths, so the pill is capped by the flex parent chain
            instead of a nested wrapper. */}
        <MessageEnter
          fresh={isFresh(message)}
          align="end"
          className="flex max-w-[92%] md:max-w-[80%] min-w-0 flex-col items-end gap-1"
        >
          {message.attachments && message.attachments.length > 0 && (
            <MessageAttachments attachments={message.attachments} />
          )}
          {text && (
            <div className={USER_PILL}>
              <p className="whitespace-pre-wrap">{text}</p>
            </div>
          )}
          {failed && <p className="text-destructive text-right text-xs">{message.error}</p>}
          {text && <MessageMeta text={text} at={message.createdAt || undefined} align="end" />}
        </MessageEnter>
      </Message>
    );
  }

  return assistantView(message, { botName, toolLabels, toolAskLabels });
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
  const { botName, toolLabels, toolAskLabels } = ctx;
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
            {message.toolCalls.map((call, i) => (
              <ToolRow
                key={`${call.id}-${i}-${call.name}`}
                call={call}
                label={toolLabel(toolLabels, call.name)}
                ask={toolAskLabel(toolAskLabels, toolLabels, call.name)}
                botName={botName}
              />
            ))}
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
        {streaming &&
          !message.text &&
          !message.reasoning &&
          !message.toolCalls?.some((c) => ACTIVE_TOOL_STATUSES.has(c.status)) && (
            <TypingIndicator />
          )}
      </div>
    </Message>
  );
}
