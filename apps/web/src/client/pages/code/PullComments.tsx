import { useMemo, useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { Streamdown } from "streamdown";
import { Badge, Button, metaLabelClass, monoClass } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { relativeTime } from "../../lib/bot-groups";
import { markdownComponents } from "../../lib/markdown";
import {
  audienceCounts,
  byAudience,
  prComments,
  type Audience,
  type PrComment,
} from "../../lib/code/pr-comments";
import type { PullView } from "../../../shared/api/code";

const TABS: Array<{ id: Audience; label: string }> = [
  { id: "all", label: "All" },
  { id: "human", label: "Humans" },
  { id: "bot", label: "Bots" },
];

const HTML_COMMENT = /<!--[\s\S]*?-->/g;

function Avatar({ login, bot }: { login: string; bot: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-medium uppercase",
        bot ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
      )}
    >
      {login.replace(/\[bot\]$/, "").slice(0, 1)}
    </span>
  );
}

const LONG = 700;

export function CommentBody({ text }: { text: string }) {
  const shown = text.replace(HTML_COMMENT, "").trim();
  const long = shown.length > LONG;
  const [open, setOpen] = useState(false);
  if (!shown) return null;
  return (
    <div className="min-w-0 space-y-1">
      <div
        className={cn(
          "chat-md code-md min-w-0 text-sm [overflow-wrap:anywhere] [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-sm [&_h4]:text-sm",
          long &&
            !open &&
            "max-h-40 overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]",
        )}
      >
        <Streamdown components={markdownComponents}>{shown}</Streamdown>
      </div>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="text-muted-foreground hover:text-foreground text-xs"
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

export function CommentByline({ author, bot, at }: { author: string; bot: boolean; at: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs">
      <Avatar login={author} bot={bot} />
      <span className="truncate font-medium">{author.replace(/\[bot\]$/, "")}</span>
      {bot && (
        <Badge variant="secondary" className="px-1.5 text-[10px]">
          Bot
        </Badge>
      )}
      <span className="text-muted-foreground shrink-0">{relativeTime(at)}</span>
    </div>
  );
}

export function PullComments({ pr, onAttach }: { pr: PullView; onAttach(text: string): void }) {
  const all = useMemo(() => prComments(pr), [pr]);
  const counts = audienceCounts(all);
  const [audience, setAudience] = useState<Audience>("all");
  const shown = byAudience(all, audience);

  if (all.length === 0) return null;
  return (
    <section aria-label="Comments" className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className={cn(metaLabelClass, "flex-1")}>Comments</h3>
        <div
          role="tablist"
          aria-label="Who wrote them"
          className="bg-muted/60 flex items-center gap-0.5 rounded-lg p-0.5"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={audience === t.id}
              onClick={() => setAudience(t.id)}
              className={cn(
                "h-6 rounded-md px-2 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                audience === t.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label} <span className="tabular-nums opacity-70">{counts[t.id]}</span>
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {audience === "bot" ? "No comments from bots." : "No comments from people."}
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((c) => (
            <CommentCard key={c.id} comment={c} autofix={pr.autofix} onAttach={onAttach} />
          ))}
        </ul>
      )}
    </section>
  );
}

const threadText = (c: PrComment) =>
  [
    `\`${c.where!.path}${c.where!.line ? `:${c.where!.line}` : ""}\``,
    `${c.author}: ${c.body}`,
    ...c.replies.map((r) => `${r.author}: ${r.body}`),
  ].join("\n");

function CommentBadges({ comment: c, autofix }: { comment: PrComment; autofix: boolean }) {
  return (
    <>
      {c.verdict && (
        <Badge variant={c.verdict === "approved" ? "secondary" : "outline"}>
          {c.verdict === "approved" ? "Approved" : "Changes requested"}
        </Badge>
      )}
      {c.ignored && autofix && (
        <Badge
          variant="outline"
          className="text-muted-foreground"
          title="Auto-fix takes instructions only from you and trusted bots. Attach it to ask the agent."
        >
          Auto-fix skips
        </Badge>
      )}
    </>
  );
}

function CommentCard({
  comment: c,
  autofix,
  onAttach,
}: {
  comment: PrComment;
  autofix: boolean;
  onAttach(text: string): void;
}) {
  const settled = c.where && (c.where.resolved || c.where.outdated);
  return (
    <li
      className={cn(
        "border-border min-w-0 space-y-2 rounded-lg border p-3",
        settled && "opacity-70",
      )}
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <CommentByline author={c.author} bot={c.bot} at={c.createdAt} />
        </div>
        <CommentBadges comment={c} autofix={autofix} />
        {c.where && !settled && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onAttach(threadText(c))}
            aria-label="Add to the message"
            title="Add to the message"
            className="text-muted-foreground"
          >
            <MessageSquarePlus />
          </Button>
        )}
      </div>
      {c.where && (
        <p className={cn("text-muted-foreground flex items-center gap-2 text-xs", monoClass)}>
          <span className="truncate">
            {c.where.path}
            {c.where.line ? `:${c.where.line}` : ""}
          </span>
          {c.where.resolved ? (
            <span className="shrink-0 font-sans">Resolved</span>
          ) : c.where.outdated ? (
            <span className="shrink-0 font-sans">Outdated</span>
          ) : null}
        </p>
      )}
      <CommentBody text={c.body} />
      {c.replies.length > 0 && (
        <ul className="border-border space-y-2 border-l pl-3">
          {c.replies.map((r) => (
            <li key={r.id} className="space-y-1">
              <CommentByline author={r.author} bot={r.bot} at={r.createdAt} />
              <CommentBody text={r.body} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
