import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, ExternalLink, GitPullRequest, Plus, X } from "lucide-react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  metaLabelClass,
  monoClass,
} from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { Spinner } from "../../components/ui/spinner";
import { errorMessage } from "../../lib/errors";
import { reviewPath, reviewsApi, useProjects } from "../../lib/code/projects";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RESOURCE_MUTATION, useResource } from "../../queries/resource";
import type { InboxPullView, InboxQuery, PullReviewView } from "../../../shared/api/code";

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

const trailClass = "flex shrink-0 items-center gap-0.5";

function GitHubLink({ number, url }: { number: number; url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open #${number} on GitHub`}
      title="Open on GitHub"
      className="text-muted-foreground hover:text-foreground hover:bg-muted/60 flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="hidden sm:inline">GitHub</span>
      <ExternalLink className="size-3.5" aria-hidden />
    </a>
  );
}

const reviewHint = (
  <span className="text-muted-foreground hidden shrink-0 items-center gap-1 text-xs sm:group-hover:inline-flex">
    Review <ArrowRight className="size-3" aria-hidden />
  </span>
);

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
      {pull.projectId && reviewHint}
      <span className={cn("text-muted-foreground hidden shrink-0 text-xs sm:inline", monoClass)}>
        {pull.repo} · @{pull.author}
      </span>
      <span className="text-muted-foreground w-14 shrink-0 text-right text-xs tabular-nums">
        {dateOf(pull.updatedAt)}
      </span>
    </>
  );
  return (
    <>
      {pull.projectId ? (
        <button
          type="button"
          className={rowClass}
          aria-label={`Review #${pull.number} ${pull.title}`}
          onClick={() => onOpen(pull)}
        >
          {inner}
        </button>
      ) : (
        <div className={cn(rowClass, "hover:bg-transparent opacity-70")}>{inner}</div>
      )}
      <span className={trailClass}>
        {!pull.projectId && (
          <Link
            to={`/code/settings/projects?repo=${encodeURIComponent(pull.repo)}`}
            aria-label={`Add ${pull.repo} as a project to review #${pull.number} here`}
            title={`Add ${pull.repo} as a project to review its PRs here`}
            className="text-muted-foreground hover:text-foreground hover:bg-muted/60 flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Plus className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">Add project</span>
          </Link>
        )}
        <GitHubLink number={pull.number} url={pull.url} />
      </span>
    </>
  );
}

const FILTER_KEY = "code.reviews.filter";

const DAYS: Array<{ value: string; label: string }> = [
  { value: "any", label: "Any time" },
  { value: "7", label: "Past week" },
  { value: "30", label: "Past 30 days" },
  { value: "90", label: "Past 90 days" },
];

function storedFilter(): InboxQuery {
  try {
    const raw = JSON.parse(window.localStorage.getItem(FILTER_KEY) ?? "{}") as InboxQuery;
    return {
      ...(typeof raw.days === "number" && raw.days > 0 ? { days: raw.days } : {}),
      ...(typeof raw.repo === "string" && raw.repo ? { repo: raw.repo } : {}),
      ...(raw.drafts === "hide" ? { drafts: "hide" as const } : {}),
    };
  } catch {
    return {};
  }
}

function storeFilter(filter: InboxQuery) {
  try {
    if (Object.keys(filter).length === 0) window.localStorage.removeItem(FILTER_KEY);
    else window.localStorage.setItem(FILTER_KEY, JSON.stringify(filter));
  } catch {}
}

const asParams = (filter: InboxQuery) => ({
  ...(filter.days ? { days: String(filter.days) } : {}),
  ...(filter.repo ? { repo: filter.repo } : {}),
  ...(filter.drafts ? { drafts: filter.drafts } : {}),
});

const chipClass =
  "h-7 w-auto gap-1 rounded-lg border-transparent bg-muted/50 px-2.5 text-xs dark:bg-muted/50";

function Filters({
  filter,
  repos,
  onChange,
}: {
  filter: InboxQuery;
  repos: string[];
  onChange(filter: InboxQuery): void;
}) {
  const set = (change: Partial<InboxQuery>) => {
    const next: InboxQuery = { ...filter, ...change };
    for (const key of Object.keys(next) as Array<keyof InboxQuery>) {
      if (next[key] === undefined) delete next[key];
    }
    onChange(next);
  };
  const active = Object.keys(filter).length > 0;
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1" role="group" aria-label="Filters">
      <Select
        value={filter.days ? String(filter.days) : "any"}
        onValueChange={(v) => set({ days: v === "any" ? undefined : Number(v) })}
      >
        <SelectTrigger size="sm" aria-label="Updated" className={chipClass}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DAYS.map((d) => (
            <SelectItem key={d.value} value={d.value}>
              {d.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={filter.repo ?? "all"}
        onValueChange={(v) => set({ repo: v === "all" ? undefined : v })}
      >
        <SelectTrigger size="sm" aria-label="Repository" className={cn(chipClass, "max-w-56")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All repositories</SelectItem>
          <SelectItem value="projects">Projects only</SelectItem>
          {repos.length > 0 && <SelectSeparator />}
          {repos.map((repo) => (
            <SelectItem key={repo} value={repo} className={monoClass}>
              {repo}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Label className="text-muted-foreground flex h-7 cursor-pointer items-center gap-2 px-2 text-xs font-normal">
        <Checkbox
          checked={filter.drafts === "hide"}
          onCheckedChange={(checked) => set({ drafts: checked === true ? "hide" : undefined })}
        />
        Hide drafts
      </Label>
      {active && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground h-7 px-2 text-xs"
          onClick={() => onChange({})}
        >
          Clear
        </Button>
      )}
    </div>
  );
}

function Inbox({
  pulls,
  error,
  filtered,
  onOpen,
  onClear,
}: {
  pulls: InboxPullView[] | null;
  error: string | null;
  filtered: boolean;
  onOpen(pull: InboxPullView): void;
  onClear(): void;
}) {
  if (error) return <p className="text-muted-foreground px-3 text-sm">{error}</p>;
  if (!pulls) {
    return (
      <div className="flex justify-center p-4" aria-label="Reading your review requests">
        <Spinner />
      </div>
    );
  }
  if (pulls.length === 0) {
    return filtered ? (
      <div className="text-muted-foreground flex items-center gap-2 px-3 text-sm">
        Nothing matches these filters.
        <Button variant="link" size="sm" className="h-auto px-0" onClick={onClear}>
          Clear filters
        </Button>
      </div>
    ) : (
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
                <li key={pull.url} className="group flex items-center gap-1">
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

function OpenHere({
  reviews,
  others,
  onClose,
}: {
  reviews: PullReviewView[] | null;
  others: PullReviewView[] | null;
  onClose(review: PullReviewView): void;
}) {
  if (!reviews) {
    return (
      <div className="flex justify-center p-6">
        <Spinner />
      </div>
    );
  }
  if (!others) return null;
  if (reviews.length === 0) {
    return (
      <p className="text-muted-foreground px-3 text-sm">
        No open reviews. Paste any pull request of a project's repository, yours or someone else's.
      </p>
    );
  }
  if (others.length === 0) return null;
  return (
    <>
      <h2 className={cn(metaLabelClass, "px-3")}>Open here</h2>
      <ul className="space-y-px" aria-label="Open reviews">
        {others.map((review) => (
          <li key={review.id} className="group flex items-center gap-1">
            <Link
              to={reviewPath(review.id)}
              aria-label={`Review #${review.number} ${review.title}`}
              className={rowClass}
            >
              <GitPullRequest className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
              <span className="text-muted-foreground shrink-0 tabular-nums">#{review.number}</span>
              <span className="min-w-0 flex-1 truncate">{review.title}</span>
              {reviewHint}
              <span
                className={cn("text-muted-foreground hidden shrink-0 text-xs sm:inline", monoClass)}
              >
                {review.repo} · @{review.author}
              </span>
              <span className="text-muted-foreground w-14 shrink-0 text-right text-xs tabular-nums">
                {dateOf(review.updatedAt)}
              </span>
            </Link>
            <span className={trailClass}>
              <GitHubLink number={review.number} url={review.url} />
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Close review of #${review.number}`}
                title="Close review"
                onClick={() => onClose(review)}
                className="text-muted-foreground"
              >
                <X />
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function ReviewsScreen() {
  const navigate = useNavigate();
  const reviewsKey = ["code", "reviews", "list"];
  const reviewList = useResource(
    reviewsKey,
    () => reviewsApi.list().catch((): PullReviewView[] => []),
    "",
  );
  const reviews = reviewList.data;
  const queryClient = useQueryClient();
  const [link, setLink] = useState("");
  const [opening, setOpening] = useState(false);
  const [filter, setFilter] = useState<InboxQuery>(storedFilter);
  const [repos, setRepos] = useState<string[]>([]);
  const addRepos = useCallback((more: string[]) => {
    setRepos((list) => {
      const all = new Set([...list, ...more]);
      return all.size === list.length ? list : [...all].sort((a, b) => a.localeCompare(b));
    });
  }, []);
  const { projects } = useProjects();
  const inbox = useResource(
    ["code", "reviews", "inbox", filter],
    () => reviewsApi.inbox(asParams(filter)),
    "Could not read your review requests.",
  );
  const pulls = inbox.data;
  const inboxError = inbox.loadError;
  useEffect(() => {
    addRepos((projects ?? []).map((p) => `${p.repo.owner}/${p.repo.name}`));
  }, [projects, addRepos]);
  useEffect(() => {
    if (pulls) addRepos(pulls.map((p) => p.repo));
  }, [pulls, addRepos]);
  const changeFilter = (next: InboxQuery) => {
    storeFilter(next);
    setFilter(next);
  };
  const filtered = Object.keys(filter).length > 0;
  const inInbox = new Set(pulls?.map((p) => p.url));
  const others =
    reviews && (pulls || inboxError) ? reviews.filter((r) => !inInbox.has(r.url)) : null;

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
    queryClient.setQueryData<PullReviewView[]>(reviewsKey, (list) =>
      list?.filter((r) => r.id !== review.id),
    );
    try {
      await reviewsApi.archive(review.id);
    } catch (error) {
      toast.error(errorMessage(error, "Could not close the review."));
      void reviewList.refresh();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header
        className={cn("border-border flex h-13 shrink-0 items-center gap-2 border-b px-3 sm:px-4")}
      >
        <Button asChild variant="ghost" size="icon-sm" className="text-muted-foreground md:hidden">
          <Link to="/code" aria-label="Back" title="Back">
            <ArrowLeft />
          </Link>
        </Button>
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
          <Filters
            filter={filter}
            repos={
              filter.repo && filter.repo !== "projects"
                ? [...new Set([...repos, filter.repo])]
                : repos
            }
            onChange={changeFilter}
          />
          <Inbox
            pulls={pulls}
            error={inboxError}
            filtered={filtered}
            onOpen={(pull) => void openPull(pull)}
            onClear={() => changeFilter({})}
          />
          <OpenHere reviews={reviews} others={others} onClose={(review) => void close(review)} />
        </div>
      </div>
    </div>
  );
}

export function OpenReviewLink() {
  const { owner, repo, number } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const pr = owner && repo && number ? `${owner}/${repo}#${number}` : search.get("pr")?.trim();
  const { mutate: openReview } = useMutation({
    mutationFn: (link: string) => reviewsApi.open(link),
    ...RESOURCE_MUTATION,
  });
  useEffect(() => {
    if (!pr) {
      navigate("/code/reviews", { replace: true });
      return;
    }
    openReview(pr, {
      onSuccess: (review) => navigate(reviewPath(review.id), { replace: true }),
      onError: (error) => {
        toast.error(errorMessage(error, "Could not open that pull request."));
        navigate("/code/reviews", { replace: true });
      },
    });
  }, [pr, navigate, openReview]);
  return (
    <div className="flex h-dvh items-center justify-center">
      <Spinner />
    </div>
  );
}
