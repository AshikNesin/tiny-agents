import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ExternalLink, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@groot/ui/lib/utils";
import { Spinner } from "../../components/ui/spinner";
import { errorMessage } from "../../lib/errors";
import { reviewPath, reviewsApi } from "../../lib/code/projects";
import { RESOURCE_MUTATION, useResource } from "../../queries/resource";
import type { InboxPullView, PullReviewView } from "../../../shared/api/code";

const REVIEWS_KEY = ["code", "reviews", "list"];
const INBOX_KEY = ["code", "reviews", "inbox"];

const rowClass =
  "group text-sidebar-foreground hover:bg-sidebar-accent/60 flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

const asksForYou = (pull: InboxPullView) => pull.section === "needs" || pull.section === "updated";

function Label({ number, title, meta }: { number: number; title: string; meta?: string }) {
  return (
    <>
      <span className="bg-warning size-1.5 shrink-0 rounded-full" aria-hidden />
      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">#{number}</span>
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {meta && <span className="text-muted-foreground shrink-0 text-xs">{meta}</span>}
    </>
  );
}

const focusOnMount = (input: HTMLInputElement | null) => input?.focus();

function PasteLink({ onOpened }: { onOpened(review: PullReviewView): void }) {
  const [link, setLink] = useState("");
  const [opening, setOpening] = useState(false);
  const open = async (event: FormEvent) => {
    event.preventDefault();
    if (!link.trim() || opening) return;
    setOpening(true);
    try {
      onOpened(await reviewsApi.open(link.trim()));
      setLink("");
    } catch (error) {
      toast.error(errorMessage(error, "Could not open that pull request."));
    } finally {
      setOpening(false);
    }
  };
  return (
    <form onSubmit={(event) => void open(event)} className="flex items-center gap-1 px-1 pb-1">
      <input
        ref={focusOnMount}
        value={link}
        onChange={(event) => setLink(event.target.value)}
        aria-label="Pull request to review"
        placeholder="PR link or owner/name#123"
        data-testid="code-review-link"
        className="border-input bg-background placeholder:text-fg-tertiary focus-visible:ring-ring/50 h-7 min-w-0 flex-1 rounded-md border px-2 text-xs outline-none focus-visible:ring-2"
      />
      {opening && <Spinner className="size-3.5" />}
    </form>
  );
}

export function ReviewList({
  activeId,
  adding,
  onAdding,
}: {
  activeId?: string;
  adding: boolean;
  onAdding(open: boolean): void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const open = useResource(REVIEWS_KEY, () => reviewsApi.list(), "Could not load your reviews.");
  const inbox = useResource(
    INBOX_KEY,
    () => reviewsApi.inbox(),
    "Could not read your review requests.",
  );
  const asked = (inbox.data ?? []).filter(asksForYou);
  const inInbox = new Set(asked.map((pull) => pull.url));
  const others = (open.data ?? []).filter((review) => !inInbox.has(review.url));

  const openPull = async (pull: InboxPullView) => {
    if (pull.reviewId) {
      navigate(reviewPath(pull.reviewId));
      return;
    }
    const pending = toast.loading(`Checking out #${pull.number}…`);
    try {
      const review = await reviewsApi.open(pull.url);
      toast.dismiss(pending);
      navigate(reviewPath(review.id));
    } catch (error) {
      toast.error(errorMessage(error, "Could not open that pull request."), { id: pending });
    }
  };

  const close = async (review: PullReviewView) => {
    queryClient.setQueryData<PullReviewView[]>(REVIEWS_KEY, (list) =>
      list?.filter((r) => r.id !== review.id),
    );
    try {
      await reviewsApi.archive(review.id);
    } catch (error) {
      toast.error(errorMessage(error, "Could not close the review."));
      void open.refresh();
    }
  };

  return (
    <section aria-label="Reviews" className="pt-2" data-testid="code-reviews">
      <div className="flex items-center pr-1 pb-1">
        <h2 className="text-muted-foreground flex-1 px-2 text-xs font-medium">Reviews</h2>
        <button
          type="button"
          onClick={() => onAdding(!adding)}
          aria-expanded={adding}
          aria-label="Review a pull request"
          title="Review a pull request (v)"
          data-testid="code-review-add"
          className="text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60 flex size-5 items-center justify-center rounded outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      {adding && (
        <PasteLink
          onOpened={(review) => {
            onAdding(false);
            void open.refresh();
            navigate(reviewPath(review.id));
          }}
        />
      )}
      <div className="space-y-px">
        {asked.map((pull) =>
          pull.projectId ? (
            <button
              key={pull.url}
              type="button"
              className={rowClass}
              aria-label={`Review #${pull.number} ${pull.title}`}
              title={`${pull.repo} by @${pull.author}`}
              data-testid="code-review-row"
              onClick={() => void openPull(pull)}
            >
              <Label
                number={pull.number}
                title={pull.title}
                meta={pull.section === "updated" ? "updated" : undefined}
              />
            </button>
          ) : (
            <a
              key={pull.url}
              href={pull.url}
              target="_blank"
              rel="noreferrer"
              className={cn(rowClass, "opacity-70")}
              aria-label={`Open #${pull.number} ${pull.title} on GitHub`}
              title={`${pull.repo} is not a project here, so this opens on GitHub`}
              data-testid="code-review-row"
            >
              <Label number={pull.number} title={pull.title} />
              <ExternalLink className="text-muted-foreground size-3 shrink-0" aria-hidden />
            </a>
          ),
        )}
        {others.map((review) => (
          <div key={review.id} className="relative">
            <Link
              to={reviewPath(review.id)}
              aria-current={review.id === activeId ? "page" : undefined}
              className={cn(rowClass, "pr-7")}
              title={`${review.repo} by @${review.author}`}
              data-testid="code-review-row"
            >
              <Label number={review.number} title={review.title} />
            </Link>
            <button
              type="button"
              onClick={() => void close(review)}
              aria-label={`Close review of #${review.number}`}
              title="Close review"
              className="text-muted-foreground hover:text-foreground absolute top-1.5 right-1.5 hidden size-5 items-center justify-center rounded group-hover:flex hover:flex focus-visible:flex [div:hover>&]:flex"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
      {inbox.loadError && (
        <p role="status" className="text-muted-foreground px-2 py-1 text-xs">
          {inbox.loadError}
        </p>
      )}
      {!inbox.loadError && inbox.data && open.data && asked.length + others.length === 0 && (
        <p className="text-muted-foreground px-2 py-1 text-xs">Nothing waits for your review.</p>
      )}
    </section>
  );
}

export function OpenReviewLink() {
  const { owner, repo, number } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const pr = owner && repo && number ? `${owner}/${repo}#${number}` : search.get("pr")?.trim();
  const { mutate: openReview } = useMutation({
    mutationFn: (link: string) => reviewsApi.open(link),
    onSuccess: () => client.invalidateQueries({ queryKey: REVIEWS_KEY }),
    ...RESOURCE_MUTATION,
  });
  useEffect(() => {
    if (!pr) {
      navigate("/code", { replace: true });
      return;
    }
    openReview(pr, {
      onSuccess: (review) => navigate(reviewPath(review.id), { replace: true }),
      onError: (error) => {
        toast.error(errorMessage(error, "Could not open that pull request."));
        navigate("/code", { replace: true });
      },
    });
  }, [pr, navigate, openReview]);
  return (
    <div className="flex h-dvh items-center justify-center">
      <Spinner />
    </div>
  );
}
