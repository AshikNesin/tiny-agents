import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, MessagesSquare } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Textarea } from "@groot/ui";
import { Spinner } from "../../components/ui/spinner";
import { errorMessage } from "../../lib/errors";
import { reviewsApi } from "../../lib/code/projects";
import { useRefreshOn, useResource } from "../../queries/resource";
import type { PullReviewView, PullThreadView } from "../../../shared/api/code";
import { CommentBody, CommentByline } from "./PullComments";
import type { LineNote } from "./UnifiedDiff";

export interface FileConversations {
  notes: LineNote[];
  aside?: ReactNode;
}

function where(thread: PullThreadView): string {
  if (thread.line === null) return thread.path;
  const what = thread.side === "old" ? "removed line" : "line";
  return thread.startLine && thread.startLine !== thread.line
    ? `${what}s ${thread.startLine}–${thread.line}`
    : `${what} ${thread.line}`;
}

function ThreadCard({
  thread,
  onReply,
  onResolve,
}: {
  thread: PullThreadView;
  onReply(body: string): Promise<void>;
  onResolve(): Promise<void>;
}) {
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? !thread.resolved;
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"reply" | "resolve" | null>(null);
  const first = thread.comments[0];

  const run = async (what: "reply" | "resolve", action: () => Promise<void>) => {
    setBusy(what);
    try {
      await action();
      if (what === "reply") {
        setText("");
        setReplying(false);
      }
    } catch (e) {
      toast.error(errorMessage(e, what === "reply" ? "Could not reply." : "Could not resolve."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      role="group"
      aria-label={`${thread.resolved ? "Resolved conversation" : "Conversation"} on ${where(thread)}`}
      className="border-border bg-background border-y px-3 py-2 font-sans text-sm [contain:inline-size]"
    >
      <button
        type="button"
        onClick={() => setToggled(!open)}
        aria-expanded={open}
        className="text-muted-foreground hover:text-foreground flex w-full min-w-0 items-center gap-1.5 text-xs"
      >
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <MessagesSquare className="size-3.5" aria-hidden />
        <span className="truncate">
          {first ? `@${first.author}` : "Conversation"}
          {thread.comments.length > 1 && ` and ${thread.comments.length - 1} more`}
        </span>
        {thread.resolved && (
          <Badge variant="secondary" className="px-1.5 text-[10px]">
            Resolved
          </Badge>
        )}
        {thread.outdated && (
          <Badge variant="outline" className="px-1.5 text-[10px]">
            Outdated
          </Badge>
        )}
      </button>
      {open && (
        <div className="mt-2 space-y-3">
          {thread.comments.map((c) => (
            <div key={c.id} className="space-y-1">
              <CommentByline author={c.author} bot={c.bot} at={c.createdAt} />
              <div className="pl-8">
                <CommentBody text={c.body} />
              </div>
            </div>
          ))}
          {replying ? (
            <div className="space-y-1.5">
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) {
                    e.preventDefault();
                    void run("reply", () => onReply(text.trim()));
                  } else if (e.key === "Escape") {
                    setReplying(false);
                  }
                }}
                autoFocus
                rows={2}
                aria-label={`Reply on ${where(thread)}`}
                placeholder="Reply on GitHub…"
                className="min-h-14 text-sm"
              />
              <div className="flex justify-end gap-1.5">
                <Button size="xs" variant="ghost" onClick={() => setReplying(false)}>
                  Cancel
                </Button>
                <Button
                  size="xs"
                  disabled={!text.trim() || busy !== null}
                  onClick={() => void run("reply", () => onReply(text.trim()))}
                  title="Reply (⌘↵)"
                >
                  {busy === "reply" && <Spinner className="size-3" />}
                  Reply
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-1.5">
              <Button size="xs" variant="outline" onClick={() => setReplying(true)}>
                Reply
              </Button>
              {!thread.resolved && (
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => void run("resolve", onResolve)}
                >
                  {busy === "resolve" && <Spinner className="size-3" />}
                  Resolve
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Elsewhere({
  threads,
  newer,
  card,
}: {
  threads: PullThreadView[];
  newer: boolean;
  card(thread: PullThreadView): ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const count = threads.length === 1 ? "1 conversation" : `${threads.length} conversations`;
  return (
    <div className="border-border border-b">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1.5 px-3 py-1.5 text-xs"
      >
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <MessagesSquare className="size-3.5" aria-hidden />
        {newer
          ? `${count} on the PR's newer commit. Update to see them in place.`
          : `${count} on code that has changed since`}
      </button>
      {open && threads.map((t) => <div key={t.id}>{card(t)}</div>)}
    </div>
  );
}

export function usePullConversations(
  review: PullReviewView | null,
  reload: unknown,
): ((path: string) => FileConversations) | undefined {
  const id = review?.id;
  const threads = useResource(
    ["code", "reviews", "threads", id],
    () => reviewsApi.threads(id!),
    "",
    { enabled: Boolean(id) },
  );
  const data =
    threads.status === "ready"
      ? threads.data
      : threads.status === "failed"
        ? (threads.last ?? null)
        : null;
  const read = threads.refresh;
  useRefreshOn(reload, read);

  return useMemo(() => {
    if (!data || !review) return undefined;
    const newer = data.headSha !== review.headSha;
    const card = (thread: PullThreadView) => (
      <ThreadCard
        key={thread.id}
        thread={thread}
        onReply={async (body) => {
          await reviewsApi.reply(review.id, thread.id, body);
          await read();
        }}
        onResolve={async () => {
          await reviewsApi.resolve(review.id, thread.id);
          await read();
        }}
      />
    );
    return (path: string) => {
      const mine = data.threads.filter((t) => t.path === path);
      const placed = newer ? [] : mine.filter((t) => t.line !== null);
      const placedIds = new Set(placed.map((t) => t.id));
      const elsewhere = mine.filter((t) => !placedIds.has(t.id));
      return {
        notes: placed.map((t) => ({ id: t.id, side: t.side, line: t.line!, node: card(t) })),
        aside:
          elsewhere.length > 0 ? (
            <Elsewhere threads={elsewhere} newer={newer} card={card} />
          ) : undefined,
      };
    };
  }, [data, review, read]);
}
