import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Ellipsis,
  ExternalLink,
  FileDiff,
  MessageSquare,
  PanelLeftClose,
  RefreshCw,
  Send,
  Sparkles,
  SquareTerminal,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Textarea, monoClass } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@groot/ui/dropdown-menu";
import { Spinner } from "../../components/ui/spinner";
import { errorMessage } from "../../lib/errors";
import { type HarnessInfo, type ModelOption, type ThreadSummary } from "../../lib/code/api";
import { reviewsApi } from "../../lib/code/projects";
import { useResource } from "../../queries/resource";
import {
  githubCommentsKey,
  useCommentStore,
  useThreadCommenting,
  useThreadComments,
} from "../../lib/code/comments";
import { harnessOf } from "../../store/code";
import type { PullReviewView } from "../../../shared/api/code";
import { ThreadView } from "./ThreadView";
import { DEFAULT, ModelPicker, loadModels } from "./controls";
import { PendingComments } from "./PendingComments";
import { AssistantPane } from "./ResizablePane";
import { PullDiffs } from "./PullDiffs";
import { DiffViewButtons, FilesButton, useDiffView } from "./DiffWorkspace";
import { usePullConversations } from "./PullThreads";
import { SubmitReviewButton } from "./SubmitReview";
import { OpenInTerminal, useOpenInTerminal, YourChangesActions } from "./YourChanges";

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
  const reviewKey = ["code", "reviews", "detail", reviewId];
  const { data: review, loadError: error } = useResource(
    reviewKey,
    () => reviewsApi.get(reviewId),
    "Could not open the review.",
  );
  const client = useQueryClient();
  const setReview = (next: PullReviewView) => client.setQueryData(reviewKey, next);
  const [updating, setUpdating] = useState(false);
  const [reload, setReload] = useState(0);
  const [side, setSide] = useState<"files" | "assistant">("files");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const view = useDiffView();
  const wide = view.wide;

  const threadId = review?.threadId ?? null;
  const assistantRow = threadId ? rows.find((r) => r.id === threadId) : undefined;
  const commentKey = threadId ?? review?.key;
  const commenting = useThreadCommenting(commentKey, () => undefined);
  const github = useThreadCommenting(githubCommentsKey(reviewId), () => undefined);
  const conversations = usePullConversations(review, `${review?.headSha}:${reload}`);
  const waiting = useThreadComments(review?.key).length;

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

  const showAssistant = side === "assistant" || assistantOpen;

  return (
    <div className="flex h-dvh min-h-0 flex-col" data-testid="code-pull-review">
      <header className="border-border flex h-12 shrink-0 items-center gap-1 border-b px-2 sm:px-3">
        <Button asChild variant="ghost" size="icon-sm" className="shrink-0">
          <Link to="/code/reviews" aria-label="All reviews" title="All reviews">
            <ArrowLeft />
          </Link>
        </Button>
        {side === "files" && <FilesButton view={view} />}
        <span className="text-muted-foreground shrink-0 px-1 text-sm tabular-nums">
          #{review.number}
        </span>
        <h1 className="min-w-0 truncate text-sm font-medium">{review.title}</h1>
        <span
          className={cn(
            "text-muted-foreground hidden min-w-0 truncate px-2 text-xs md:inline",
            monoClass,
          )}
          title={`${review.headRef} into ${review.baseRef}`}
        >
          {review.repo} · @{review.author} · {review.headRef} → {review.baseRef}
        </span>
        <span className="flex-1" />
        <div className="hidden items-center gap-0.5 lg:flex">
          <DiffViewButtons view={view} />
          <span className="bg-border mx-1 h-4 w-px" aria-hidden />
        </div>
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
        <div className="hidden items-center gap-1 sm:flex">
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
        </div>
        <MoreActions review={review} updating={updating} onUpdate={() => void update()} />
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
        {!assistantOpen && (
          <AssistantRail waiting={waiting} onOpen={() => setAssistantOpen(true)} />
        )}
        {showAssistant && (
          <AssistantPane
            resizable={assistantOpen}
            className={cn(
              "border-border lg:border-r",
              side === "assistant" ? undefined : "hidden lg:flex",
              !assistantOpen && "lg:hidden",
            )}
          >
            <div className="flex h-10 shrink-0 items-center gap-2 px-3">
              <Sparkles className="text-muted-foreground size-4" aria-hidden />
              <h2 className="flex-1 text-sm font-medium">Assistant</h2>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hidden lg:inline-flex"
                aria-label="Collapse assistant"
                title="Collapse assistant"
                onClick={() => setAssistantOpen(false)}
              >
                <PanelLeftClose />
              </Button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <Assistant
                review={review}
                harnesses={harnesses}
                rows={rows}
                onStarted={(id) => setReview({ ...review, threadId: id })}
              />
            </div>
          </AssistantPane>
        )}
        <main
          className={cn("min-w-0 flex-1 flex-col", side === "files" ? "flex" : "hidden lg:flex")}
        >
          <PullDiffs
            review={review}
            refreshKey={`${review.headSha}:${reload}:${assistantRow?.working}:${assistantRow?.cursor}`}
            view={view}
            commenting={commenting}
            github={github}
            conversations={conversations}
            onAskedAssistant={() => {
              if (wide) setAssistantOpen(true);
            }}
            yourChanges={(done) => (
              <YourChangesActions
                review={review}
                onChanged={(headSha) => {
                  if (headSha) setReview({ ...review, headSha });
                  done();
                }}
              />
            )}
          />
        </main>
      </div>
    </div>
  );
}

function AssistantRail({ waiting, onOpen }: { waiting: number; onOpen(): void }) {
  return (
    <div className="border-border hidden w-11 shrink-0 flex-col items-center gap-1 border-r py-2 lg:flex">
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground relative"
        aria-label={waiting > 0 ? `Open assistant, ${waiting} comments waiting` : "Open assistant"}
        title="Open assistant"
        onClick={onOpen}
      >
        <Sparkles />
        {waiting > 0 && (
          <span className="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full text-[10px] tabular-nums">
            {waiting}
          </span>
        )}
      </Button>
      <button
        type="button"
        onClick={onOpen}
        tabIndex={-1}
        aria-hidden
        className="text-muted-foreground hover:text-foreground mt-1 text-xs [writing-mode:vertical-rl]"
      >
        Assistant
      </button>
    </div>
  );
}

function MoreActions({
  review,
  updating,
  onUpdate,
}: {
  review: PullReviewView;
  updating: boolean;
  onUpdate(): void;
}) {
  const terminal = useOpenInTerminal(review);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="More actions"
          className="text-muted-foreground sm:hidden"
        >
          {updating || terminal.opening ? <Spinner /> : <Ellipsis />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem disabled={terminal.opening} onSelect={() => void terminal.open()}>
          <SquareTerminal />
          Open in terminal
        </DropdownMenuItem>
        <DropdownMenuItem disabled={updating} onSelect={onUpdate}>
          <RefreshCw />
          Update to the latest commit
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={review.url} target="_blank" rel="noreferrer">
            <ExternalLink />
            Open on GitHub
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
  const harness = harnessOf(harnesses, review.assistant?.instanceId);
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
    <ThreadView
      key={threadId}
      header={false}
      id={threadId}
      harness={harness}
      rows={rows}
      insert={null}
    />
  );
}

function AskFirst({
  review,
  onStarted,
}: {
  review: PullReviewView;
  onStarted(threadId: string): void;
}) {
  const [text, setText] = useState("");
  const [asking, setAsking] = useState(false);
  const [model, setModel] = useState(review.assistant?.model ?? DEFAULT);
  const [models, setModels] = useState<ModelOption[]>([]);
  const instanceId = review.assistant?.instanceId;
  useEffect(() => {
    if (!instanceId) return;
    let cancelled = false;
    loadModels(instanceId)
      .then((list) => !cancelled && setModels(list))
      .catch(() => !cancelled && setModels([]));
    return () => {
      cancelled = true;
    };
  }, [instanceId]);
  const comments = useThreadComments(review.key);
  const sent = useCommentStore((s) => s.sent);
  const count = comments.length;

  const ask = useCallback(
    async (question: string) => {
      if (!question.trim() || asking) return;
      setAsking(true);
      try {
        const { threadId } = await reviewsApi.ask(review.id, {
          message: question.trim(),
          ...(model !== DEFAULT ? { model } : {}),
        });
        sent(review.key);
        onStarted(threadId);
      } catch (e) {
        toast.error(errorMessage(e, "Could not ask the assistant."));
        setAsking(false);
      }
    },
    [asking, review.id, review.key, sent, onStarted, model],
  );
  const placeholder = useMemo(
    () => (count > 0 ? "Ask about your comments, or the PR…" : "Ask about this PR…"),
    [count],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-2">
        <div className="mx-auto max-w-xl space-y-3">
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
          className="bg-muted/40 border-border focus-within:ring-ring/50 @container flex flex-col gap-1 rounded-2xl border p-2 focus-within:ring-3"
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
          <div className="flex items-center gap-1">
            {models.length > 0 && (
              <ModelPicker models={models} value={model} onChange={setModel} withDefault />
            )}
            <span className="flex-1" />
            <Button
              type="submit"
              size="icon-sm"
              aria-label="Ask"
              disabled={asking || !text.trim()}
              className="shrink-0 rounded-full"
            >
              {asking ? <Spinner /> : <Send />}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
