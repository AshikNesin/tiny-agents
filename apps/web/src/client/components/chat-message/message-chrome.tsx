import { useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@groot/ui/lib/utils";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import type { ChatMessage } from "../../lib/chat-types";

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

export function CopyButton({ text, at }: { text: string; at?: number }) {
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

export function MessageMeta({
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

export function MessageEnter({
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

export function isFresh(message: ChatMessage): boolean {
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
