/**
 * A PR review (`/code/reviews/<id>`, issue #345): the pull request's
 * changes at full height (file list beside the diff, Viewed marks, line
 * comments), and its assistant on the right, behind the same divider as a
 * thread's panel. Focus mode: no thread list. A line comment is for the
 * PR's review on GitHub (sent with Submit review) or for the assistant.
 *
 * The assistant starts on the first question (nothing calls a model until
 * then): its first message carries a short card of the PR, any line comments
 * waiting, and the question. After that it is the thread itself, shown
 * without its header. Phones show one side at a time.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ExternalLink,
  FileDiff,
  MessageSquare,
  RefreshCw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button, EmptyState, Textarea, monoClass } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { Spinner } from "../../components/ui/spinner";
import { errorMessage } from "../../lib/errors";
import { instanceOf, type HarnessInfo, type ThreadSummary } from "../../lib/code/api";
import { reviewsApi } from "../../lib/code/projects";
import {
  githubCommentsKey,
  useCommentStore,
  useThreadCommenting,
  useThreadComments,
} from "../../lib/code/comments";
import { harnessOf } from "../../store/code";
import type { PullReviewView } from "../../../shared/api/code";
import { ConversationView } from "./ConversationView";
import { PendingComments } from "./PendingComments";
import { ResizablePane } from "./ResizablePane";
import { ReviewPanel } from "./ReviewPanel";
import { usePullConversations } from "./PullThreads";
import { SubmitReviewButton } from "./SubmitReview";
import { OpenInTerminal, YourChangesActions } from "./YourChanges";

/** Questions a reviewer asks first, one tap each. */
const STARTERS = ["Summarize this PR", "What could break?", "Is it tested well?"];

export function PullReview({
  reviewId,
  harnesses,
  rows,
}: {
  reviewId: string;
  harnesses: HarnessInfo[];
  rows: ThreadSummary[];
}) {
  const navigate = useNavigate();
  const [review, setReview] = useState<PullReviewView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [reload, setReload] = useState(0);
  // Phones: the diff or the assistant.
  const [side, setSide] = useState<"files" | "assistant">("files");

  useEffect(() => {
    let cancelled = false;
    reviewsApi
      .get(reviewId)
      .then((r) => !cancelled && setReview(r))
      .catch((e: unknown) => !cancelled && setError(errorMessage(e, "Could not open the review.")));
    return () => {
      cancelled = true;
    };
  }, [reviewId]);

  const threadId = review?.threadId ?? null;
  const assistantRow = threadId ? rows.find((r) => r.id === threadId) : undefined;
  // Comments wait under the review until the assistant exists, then under its thread.
  const commentKey = threadId ?? review?.key;
  const commenting = useThreadCommenting(commentKey, () => undefined);
  const github = useThreadCommenting(githubCommentsKey(reviewId), () => undefined);
  const conversations = usePullConversations(review, `${review?.headSha}:${reload}`);

  const update = async () => {
    if (!review) return;
    setUpdating(true);
    try {
      const next = await reviewsApi.open(review.url);
      setReview(next);
      setReload((n) => n + 1);
      if (next.headSha !== review.headSha) toast.success("Moved to the PR's latest commit.");
    } catch (e) {
      toast.error(errorMessage(e, "Could not update the review."));
    } finally {
      setUpdating(false);
    }
  };

  const close = async () => {
    if (!review) return;
    try {
      await reviewsApi.archive(review.id);
      navigate("/code/reviews");
    } catch (e) {
      toast.error(errorMessage(e, "Could not close the review."));
    }
  };

  if (error) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <EmptyState icon={FileDiff} title="This review is not available" description={error} />
        <div className="flex justify-center">
          <Button asChild variant="outline">
            <Link to="/code/reviews">All reviews</Link>
          </Button>
        </div>
      </div>
    );
  }
  if (!review) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col" data-testid="code-pull-review">
      <header className="border-border flex h-13 shrink-0 items-center gap-1 border-b px-2 sm:px-3">
        <Button asChild variant="ghost" size="icon-sm" className="shrink-0">
          <Link to="/code/reviews" aria-label="All reviews" title="All reviews">
            <ArrowLeft />
          </Link>
        </Button>
        <span className="text-muted-foreground shrink-0 px-1 text-sm tabular-nums">
          #{review.number}
        </span>
        <h1 className="min-w-0 truncate text-sm font-medium">{review.title}</h1>
        <span
          className={cn("text-muted-foreground hidden shrink-0 px-2 text-xs md:inline", monoClass)}
        >
          {review.repo} · @{review.author}
        </span>
        <span className="flex-1" />
        {github && <SubmitReviewButton review={review} github={github} />}
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground lg:hidden"
          aria-pressed={side === "assistant"}
          onClick={() => setSide(side === "files" ? "assistant" : "files")}
        >
          {side === "files" ? <MessageSquare /> : <FileDiff />}
          {side === "files" ? "Assistant" : "Files"}
        </Button>
        <OpenInTerminal review={review} />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void update()}
          disabled={updating}
          aria-label="Update to the latest commit"
          title="Update to the PR's latest commit"
          className="text-muted-foreground"
        >
          {updating ? <Spinner /> : <RefreshCw />}
        </Button>
        <Button asChild variant="ghost" size="icon-sm" className="text-muted-foreground">
          <a
            href={review.url}
            target="_blank"
            rel="noreferrer"
            aria-label="Open on GitHub"
            title="Open on GitHub"
          >
            <ExternalLink />
          </a>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void close()}
          aria-label="Close review"
          title="Close review (removes its checkout)"
          className="text-muted-foreground"
        >
          <X />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1">
        <main
          className={cn(
            "min-w-0 flex-1 flex-col lg:min-w-90",
            side === "files" ? "flex" : "hidden lg:flex",
          )}
        >
          <ReviewPanel
            threadId={review.key}
            baseBranch={review.baseRef}
            pull={{
              headRef: review.headRef,
              reviewedSha: review.reviewedSha !== review.headSha ? review.reviewedSha : null,
              yourChanges: (done) => (
                <YourChangesActions
                  review={review}
                  onChanged={(headSha) => {
                    if (headSha) setReview({ ...review, headSha });
                    done();
                  }}
                />
              ),
            }}
            refreshKey={`${review.headSha}:${reload}:${assistantRow?.working}:${assistantRow?.cursor}`}
            page
            editable
            commenting={commenting}
            githubCommenting={github}
            conversations={conversations}
          />
        </main>
        <ResizablePane narrow className={side === "assistant" ? undefined : "hidden lg:flex"}>
          <div className="flex min-h-0 flex-1 flex-col">
            <Assistant
              review={review}
              harnesses={harnesses}
              rows={rows}
              onStarted={(id) => setReview({ ...review, threadId: id })}
            />
          </div>
        </ResizablePane>
      </div>
    </div>
  );
}

/** The assistant's side: its thread once asked, the first-question box before. */
function Assistant({
  review,
  harnesses,
  rows,
  onStarted,
}: {
  review: PullReviewView;
  harnesses: HarnessInfo[];
  rows: ThreadSummary[];
  onStarted(threadId: string): void;
}) {
  const threadId = review.threadId;
  if (!threadId) return <AskFirst review={review} onStarted={onStarted} />;
  const harness = harnessOf(harnesses, instanceOf(threadId));
  if (!harness) {
    return (
      <EmptyState
        icon={MessageSquare}
        title="The assistant's coding agent is not connected"
        description="Its thread belongs to a harness this server does not run now."
      />
    );
  }
  return (
    <ConversationView
      key={threadId}
      pane
      id={threadId}
      harness={harness}
      rows={rows}
      panelOpen={false}
      onTogglePanel={() => undefined}
      insert={null}
    />
  );
}

/** Before the first question: what the assistant is, starter questions and a box. */
function AskFirst({
  review,
  onStarted,
}: {
  review: PullReviewView;
  onStarted(threadId: string): void;
}) {
  const [text, setText] = useState("");
  const [asking, setAsking] = useState(false);
  const comments = useThreadComments(review.key);
  const sent = useCommentStore((s) => s.sent);
  const count = comments.length;

  const ask = useCallback(
    async (question: string) => {
      if (!question.trim() || asking) return;
      setAsking(true);
      try {
        const { threadId } = await reviewsApi.ask(review.id, question.trim());
        sent(review.key);
        onStarted(threadId);
      } catch (e) {
        toast.error(errorMessage(e, "Could not ask the assistant."));
        setAsking(false);
      }
    },
    [asking, review.id, review.key, sent, onStarted],
  );
  const placeholder = useMemo(
    () => (count > 0 ? "Ask about your comments, or the PR…" : "Ask about this PR…"),
    [count],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-6">
        <div className="mx-auto max-w-xl space-y-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="text-muted-foreground size-4" aria-hidden />
            Assistant
          </p>
          <p className="text-muted-foreground text-sm">
            Ask anything about #{review.number}. It works in a checkout of the PR and reads the code
            it needs. Select lines in the diff to ask about them. Nothing runs until you ask.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {STARTERS.map((starter) => (
              <Button
                key={starter}
                size="xs"
                variant="outline"
                disabled={asking}
                onClick={() => void ask(starter)}
              >
                {starter}
              </Button>
            ))}
          </div>
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl space-y-2 px-3 pb-3">
        <PendingComments threadId={review.key} sendNow={false} />
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void ask(text);
          }}
          className="bg-muted/40 border-border focus-within:ring-ring/50 flex items-end gap-2 rounded-2xl border p-2 focus-within:ring-3"
        >
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void ask(text);
              }
            }}
            placeholder={placeholder}
            aria-label="Ask the assistant"
            rows={2}
            className="max-h-40 min-h-10 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          <Button
            type="submit"
            size="icon-sm"
            aria-label="Ask"
            disabled={asking || !text.trim()}
            className="shrink-0 rounded-full"
          >
            {asking ? <Spinner /> : <Send />}
          </Button>
        </form>
      </div>
    </div>
  );
}
