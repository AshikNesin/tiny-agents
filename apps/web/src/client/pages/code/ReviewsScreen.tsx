/**
 * Reviews (`/code/reviews`, issue #345): open any pull request of a
 * project's repository by pasting its link (or `owner/name#123`), the
 * owner's own or someone else's. Above the reviews still open here, the
 * inbox from GitHub across every repository: what needs their review, what
 * changed since they reviewed, what waits on its author, and their own.
 * `/code/review/<owner>/<name>/<number>` opens one straight from a link.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ExternalLink, GitPullRequest, X } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Input, metaLabelClass, monoClass } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { Spinner } from "../../components/ui/spinner";
import { errorMessage } from "../../lib/errors";
import { reviewPath, reviewsApi } from "../../lib/code/projects";
import type { InboxPullView, PullReviewView } from "../../../shared/api/code";

const dateOf = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

const SECTIONS: Array<{ id: InboxPullView["section"]; title: string }> = [
  { id: "needs", title: "Needs your review" },
  { id: "updated", title: "Updated since your review" },
  { id: "waiting", title: "Waiting on author" },
  { id: "mine", title: "Your pull requests" },
];

const DECISION: Record<NonNullable<InboxPullView["decision"]>, string | null> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  review_required: null,
};

const rowClass =
  "hover:bg-muted/60 flex h-10 min-w-0 flex-1 items-center gap-3 rounded-lg px-3 text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

function InboxRow({ pull, onOpen }: { pull: InboxPullView; onOpen(pull: InboxPullView): void }) {
  const badge = pull.draft ? "Draft" : pull.decision ? DECISION[pull.decision] : null;
  const inner = (
    <>
      <GitPullRequest className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
      <span className="text-muted-foreground shrink-0 tabular-nums">#{pull.number}</span>
      <span className="min-w-0 flex-1 truncate">{pull.title}</span>
      {badge && (
        <Badge variant="secondary" className="hidden shrink-0 px-1.5 text-[10px] sm:inline-flex">
          {badge}
        </Badge>
      )}
      <span className={cn("text-muted-foreground hidden shrink-0 text-xs sm:inline", monoClass)}>
        {pull.repo} · @{pull.author}
      </span>
      <span className="text-muted-foreground w-14 shrink-0 text-right text-xs tabular-nums">
        {dateOf(pull.updatedAt)}
      </span>
    </>
  );
  if (!pull.projectId) {
    // Reviewing here needs a project (its checkout); GitHub still opens it.
    return (
      <a
        href={pull.url}
        target="_blank"
        rel="noreferrer"
        className={cn(rowClass, "opacity-70")}
        title={`${pull.repo} is not a project. Add it in Code settings → Projects to review it here.`}
      >
        {inner}
        <ExternalLink className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
      </a>
    );
  }
  return (
    <button type="button" className={rowClass} onClick={() => onOpen(pull)}>
      {inner}
    </button>
  );
}

/** The inbox from GitHub, by section; nothing while it reads, a line when it cannot. */
function Inbox({ onOpen }: { onOpen(pull: InboxPullView): void }) {
  const [pulls, setPulls] = useState<InboxPullView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    reviewsApi
      .inbox()
      .then(setPulls)
      .catch((e: unknown) => setError(errorMessage(e, "Could not read your review requests.")));
  }, []);
  if (error) return <p className="text-muted-foreground px-3 text-sm">{error}</p>;
  if (!pulls) {
    return (
      <div className="flex justify-center p-4" aria-label="Reading your review requests">
        <Spinner />
      </div>
    );
  }
  if (pulls.length === 0) {
    return (
      <p className="text-muted-foreground px-3 text-sm">
        Nothing asks for your review on GitHub right now.
      </p>
    );
  }
  return (
    <>
      {SECTIONS.map(({ id, title }) => {
        const rows = pulls.filter((p) => p.section === id);
        if (rows.length === 0) return null;
        return (
          <section key={id} aria-label={title} className="space-y-1">
            <h2 className={cn(metaLabelClass, "px-3")}>
              {title} <span className="tabular-nums">{rows.length}</span>
            </h2>
            <ul className="space-y-px">
              {rows.map((pull) => (
                <li key={pull.url} className="flex">
                  <InboxRow pull={pull} onOpen={onOpen} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

export function ReviewsScreen({ sidebarHidden = false }: { sidebarHidden?: boolean }) {
  const navigate = useNavigate();
  const [reviews, setReviews] = useState<PullReviewView[] | null>(null);
  const [link, setLink] = useState("");
  const [opening, setOpening] = useState(false);

  const load = useCallback(() => {
    reviewsApi
      .list()
      .then(setReviews)
      .catch(() => setReviews([]));
  }, []);
  useEffect(load, [load]);

  const open = async (event: FormEvent) => {
    event.preventDefault();
    if (!link.trim()) return;
    setOpening(true);
    try {
      const review = await reviewsApi.open(link.trim());
      navigate(reviewPath(review.id));
    } catch (error) {
      toast.error(errorMessage(error, "Could not open that pull request."));
    } finally {
      setOpening(false);
    }
  };

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
    setReviews((list) => list?.filter((r) => r.id !== review.id) ?? list);
    try {
      await reviewsApi.archive(review.id);
    } catch (error) {
      toast.error(errorMessage(error, "Could not close the review."));
      load();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header
        className={cn(
          "border-border flex h-13 shrink-0 items-center gap-2 border-b px-3 sm:px-4",
          sidebarHidden && "md:pl-12",
        )}
      >
        <Link to="/code" className="text-muted-foreground hover:text-foreground text-sm md:hidden">
          Back
        </Link>
        <h1 className="px-2 text-sm font-medium">Reviews</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl space-y-4 px-3 py-4 sm:px-6">
          <form onSubmit={(e) => void open(e)} className="flex gap-2">
            <Input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="Paste a pull request link, or owner/name#123"
              aria-label="Pull request"
              className="h-9"
            />
            <Button type="submit" disabled={opening || !link.trim()}>
              {opening && <Spinner />}
              Review
            </Button>
          </form>
          <Inbox onOpen={(pull) => void openPull(pull)} />
          {reviews && reviews.length > 0 && (
            <h2 className={cn(metaLabelClass, "px-3")}>Open here</h2>
          )}
          {!reviews ? (
            <div className="flex justify-center p-6">
              <Spinner />
            </div>
          ) : reviews.length === 0 ? (
            <p className="text-muted-foreground px-3 text-sm">
              No open reviews. Paste any pull request of a project's repository, yours or someone
              else's.
            </p>
          ) : (
            <ul className="space-y-px" aria-label="Open reviews">
              {reviews.map((review) => (
                <li key={review.id} className="group flex items-center gap-1">
                  <Link
                    to={reviewPath(review.id)}
                    className="hover:bg-muted/60 flex h-10 min-w-0 flex-1 items-center gap-3 rounded-lg px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <GitPullRequest
                      className="text-muted-foreground size-3.5 shrink-0"
                      aria-hidden
                    />
                    <span className="text-muted-foreground shrink-0 tabular-nums">
                      #{review.number}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{review.title}</span>
                    <span
                      className={cn(
                        "text-muted-foreground hidden shrink-0 text-xs sm:inline",
                        monoClass,
                      )}
                    >
                      {review.repo} · @{review.author}
                    </span>
                    <span className="text-muted-foreground w-14 shrink-0 text-right text-xs tabular-nums">
                      {dateOf(review.updatedAt)}
                    </span>
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Close review of #${review.number}`}
                    title="Close review"
                    onClick={() => void close(review)}
                    className="text-muted-foreground opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/** `/code/review/<owner>/<name>/<number>`: open (or reopen) that PR's review and go there. */
export function OpenReviewLink() {
  const { owner, repo, number } = useParams();
  const navigate = useNavigate();
  useEffect(() => {
    reviewsApi
      .open(`${owner}/${repo}#${number}`)
      .then((review) => navigate(reviewPath(review.id), { replace: true }))
      .catch((error: unknown) => {
        toast.error(errorMessage(error, "Could not open that pull request."));
        navigate("/code/reviews", { replace: true });
      });
  }, [owner, repo, number, navigate]);
  return (
    <div className="flex h-dvh items-center justify-center">
      <Spinner />
    </div>
  );
}
