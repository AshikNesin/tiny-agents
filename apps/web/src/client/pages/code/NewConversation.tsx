/**
 * Start a Shelley conversation (issue #143): one composer for the task, with
 * the model and reasoning chips inside it and, under it, the working
 * directory (searchable: recent ones, a typed path, a folder browser,
 * validated by Shelley) and an optional fresh git worktree so parallel tasks
 * on one repo don't collide.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  CircleCheck,
  ChevronUp,
  CornerDownLeft,
  Folder,
  FolderGit2,
  FolderOpen,
  GitBranchPlus,
} from "lucide-react";
import { Button, metaLabelClass, monoClass } from "@groot/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@groot/ui/dialog";
import { cn } from "@groot/ui/lib/utils";
import {
  SearchSelect,
  searchSelectTriggerClass,
  type SearchSelectOption,
} from "../../components/ui/search-select";
import { Spinner } from "../../components/ui/spinner";
import {
  conversationTitle,
  shelleyApi,
  shortPath,
  type DirectoryListing,
  type ShelleyConversation,
  type ShelleyModel,
  type ThinkingLevel,
} from "../../lib/shelley/api";
import { Composer } from "./Composer";
import { DEFAULT, ModelPicker, ReasoningPicker, loadModels, modelLabel } from "./controls";

const CWD_KEY = "tiny-agents:shelley-cwd";
const MODEL_KEY = "tiny-agents:shelley-model";
const THINKING_KEY = "tiny-agents:shelley-thinking";

function read(key: string, fallback = ""): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Remembered per browser: the last directory, model and reasoning level used. */
function save(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // not remembered in private mode
  }
}

function DirectoryBrowser({
  open,
  start,
  onPick,
  onOpenChange,
}: {
  open: boolean;
  start: string;
  onPick(path: string): void;
  onOpenChange(open: boolean): void;
}) {
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const go = (path?: string) => {
    setError(null);
    shelleyApi
      .directories(path)
      .then(setListing)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  useEffect(() => {
    if (open) go(start || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when opened
  }, [open]);
  const dirs = (listing?.entries ?? []).filter((e) => e.is_dir && !e.name.startsWith("."));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Choose a working directory</DialogTitle>
          <DialogDescription>Folders on Shelley's machine.</DialogDescription>
        </DialogHeader>
        {error && <p className="text-destructive text-sm">{error}</p>}
        {!listing ? (
          <Spinner />
        ) : (
          <div className="space-y-2">
            <p
              className={cn("text-muted-foreground truncate text-xs", monoClass)}
              title={listing.path}
            >
              {listing.path}
              {listing.git_repo_root ? " · git" : ""}
            </p>
            <ul className="border-border max-h-72 overflow-y-auto rounded-lg border p-1">
              {listing.parent && (
                <li>
                  <button
                    type="button"
                    onClick={() => go(listing.parent)}
                    className="hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                  >
                    <ChevronUp className="text-muted-foreground size-4" />
                    ..
                  </button>
                </li>
              )}
              {dirs.length === 0 && (
                <li className="text-muted-foreground px-2 py-1.5 text-sm">No folders here.</li>
              )}
              {dirs.map((d) => (
                <li key={d.name}>
                  <button
                    type="button"
                    onClick={() => go(`${listing.path.replace(/\/$/, "")}/${d.name}`)}
                    className="hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                  >
                    <Folder className="text-muted-foreground size-4" />
                    {d.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!listing}
            onClick={() => {
              if (listing) onPick(listing.path);
              onOpenChange(false);
            }}
          >
            Use this folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "now", "4m", "5h", "3d" — how long ago, compactly. */
export function shortAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 60) return `${Math.floor(days / 7)}w`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The latest top-level conversations under the composer, Cursor-agents style. */
function RecentTasks({ rows, models }: { rows: ShelleyConversation[]; models: ShelleyModel[] }) {
  const recent = rows
    .filter((r) => !r.parent_conversation_id)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 6);
  if (recent.length === 0) return null;
  const subagentCount = new Map<string, number>();
  for (const r of rows) {
    if (r.parent_conversation_id)
      subagentCount.set(
        r.parent_conversation_id,
        (subagentCount.get(r.parent_conversation_id) ?? 0) + 1,
      );
  }
  return (
    <section aria-label="Recent conversations" className="space-y-1">
      <h2 className={cn(metaLabelClass, "px-2 pb-1")}>Recent</h2>
      <ul className="space-y-px">
        {recent.map((row) => {
          const children = subagentCount.get(row.conversation_id) ?? 0;
          const model = models.find((m) => m.id === row.model);
          return (
            <li key={row.conversation_id}>
              <Link
                to={`/code/${row.conversation_id}`}
                className="hover:bg-muted flex items-center gap-3 rounded-xl px-2 py-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                data-testid="code-recent-task"
              >
                <span
                  className="bg-muted/60 text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-foreground/5"
                  aria-hidden
                >
                  {row.working ? (
                    <Spinner className="size-4" />
                  ) : (
                    <CircleCheck className="size-4" />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className={cn("truncate text-sm", row.unread && "font-medium")}>
                      {conversationTitle(row)}
                    </span>
                    {row.unread && (
                      <span
                        className="bg-primary size-1.5 shrink-0 rounded-full"
                        aria-label="Unread"
                      />
                    )}
                  </span>
                  <span className="text-muted-foreground flex min-w-0 items-center gap-2 text-xs">
                    {row.working ? (
                      <span>Working</span>
                    ) : (
                      model && <span className="truncate">{modelLabel(model)}</span>
                    )}
                    {(row.git_repo_root || row.cwd) && (
                      <span className="truncate">
                        {(row.git_repo_root || row.cwd)!.split("/").filter(Boolean).pop()}
                      </span>
                    )}
                    {children > 0 && (
                      <span className="flex shrink-0 items-center gap-0.5">
                        <Bot className="size-3" />
                        {children}
                      </span>
                    )}
                    <span className="shrink-0 tabular-nums">{shortAgo(row.updated_at)}</span>
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function NewConversation({ rows }: { rows: ShelleyConversation[] }) {
  const navigate = useNavigate();
  const [cwd, setCwd] = useState(() => read(CWD_KEY));
  const [cwdError, setCwdError] = useState<string | null>(null);
  const [worktree, setWorktree] = useState(false);
  const [models, setModels] = useState<ShelleyModel[]>([]);
  const [model, setModel] = useState(() => read(MODEL_KEY, DEFAULT));
  const [thinking, setThinking] = useState<ThinkingLevel | "default">(
    () => read(THINKING_KEY, DEFAULT) as ThinkingLevel | "default",
  );
  const [browsing, setBrowsing] = useState(false);

  useEffect(() => {
    void loadModels()
      .then((list) => {
        setModels(list);
        const ready = list.filter((m) => m.ready);
        setModel((current) =>
          current === DEFAULT || ready.some((m) => m.id === current) ? current : DEFAULT,
        );
      })
      .catch(() => setModels([]));
  }, []);

  // Recent directories, most recent first: one click to reuse.
  const recent = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const row of [...rows].sort((a, b) => b.updated_at.localeCompare(a.updated_at))) {
      const dir = row.cwd;
      if (!dir || seen.has(dir)) continue;
      seen.add(dir);
      list.push(dir);
      if (list.length >= 8) break;
    }
    return list;
  }, [rows]);

  const validate = async (path: string) => {
    if (!path.trim()) {
      setCwdError(null);
      return true;
    }
    try {
      const result = await shelleyApi.validateCwd(path.trim());
      setCwdError(result.valid ? null : (result.error ?? "Shelley can't use this directory."));
      return result.valid;
    } catch {
      setCwdError(null);
      return true;
    }
  };

  const pickDir = (path: string) => {
    setCwd(path);
    setCwdError(null);
    if (!path) setWorktree(false);
    void validate(path);
  };

  const start = async (message: string) => {
    let dir = cwd.trim();
    if (dir && !(await validate(dir))) throw new Error("Pick a directory Shelley can use.");
    if (worktree && dir) {
      const created = await shelleyApi.createWorktree(dir);
      if (!created.path) throw new Error("Shelley could not create a worktree here.");
      dir = created.path;
    }
    if (cwd.trim()) save(CWD_KEY, cwd.trim());
    save(MODEL_KEY, model);
    save(THINKING_KEY, thinking);
    const { conversationId } = await shelleyApi.create({
      message,
      ...(dir ? { cwd: dir } : {}),
      ...(model !== DEFAULT ? { model } : {}),
      ...(thinking !== DEFAULT ? { thinkingLevel: thinking } : {}),
    });
    navigate(`/code/${conversationId}`);
  };

  const selectedModel = models.find((m) => m.id === model) ?? models.find((m) => m.is_default);
  const dirOptions: SearchSelectOption[] = [
    {
      value: "",
      label: "Shelley's default",
      description: "Its home directory",
      icon: <Folder className="text-muted-foreground" />,
    },
    ...[...new Set([...(cwd ? [cwd] : []), ...recent])].map((dir) => ({
      value: dir,
      label: shortPath(dir),
      description: dir,
      keywords: [dir],
      group: "Recent",
      icon: <FolderGit2 className="text-muted-foreground" />,
    })),
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-13 shrink-0 items-center gap-1 px-2 md:hidden">
        <Button asChild variant="ghost" size="icon-sm" aria-label="All conversations">
          <Link to="/code">
            <ArrowLeft />
          </Link>
        </Button>
        <span className="text-sm font-medium">New conversation</span>
      </div>
      <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-8 overflow-y-auto px-4 pt-6 pb-8 md:pt-[12vh]">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1 px-1.5" data-testid="code-new-options">
            <SearchSelect
              label="Working directory"
              value={cwd}
              onValueChange={pickDir}
              options={dirOptions}
              searchPlaceholder="Search or type a path…"
              emptyText="Type a full path to use it."
              contentClassName="w-80"
              createOption={(query) =>
                query.startsWith("/") || query.startsWith("~")
                  ? {
                      key: "use-path",
                      label: `Use “${query}”`,
                      icon: <CornerDownLeft className="text-muted-foreground" />,
                      onSelect: pickDir,
                    }
                  : null
              }
              actions={[
                {
                  key: "browse",
                  label: "Browse folders…",
                  icon: <FolderOpen className="text-muted-foreground" />,
                  onSelect: () => setBrowsing(true),
                },
              ]}
              triggerClassName={cn(cwdError && "text-destructive")}
              data-testid="code-cwd"
            >
              <FolderGit2 className="opacity-70" />
              <span className={cn("max-w-56 truncate", cwd && monoClass)}>
                {cwd ? shortPath(cwd) : "Shelley's default directory"}
              </span>
              <ChevronDown className="opacity-50" />
            </SearchSelect>
            <button
              type="button"
              onClick={() => setWorktree((w) => !w)}
              disabled={!cwd.trim()}
              aria-pressed={worktree}
              title={
                cwd.trim()
                  ? "Work in a new git worktree, so parallel tasks on one repo don't collide"
                  : "Pick a directory first"
              }
              className={cn(searchSelectTriggerClass, worktree && "bg-muted text-foreground")}
              data-testid="code-worktree"
            >
              <GitBranchPlus className="opacity-70" />
              New worktree
              {worktree && <Check className="size-3" />}
            </button>
          </div>
          <Composer
            draftKey="new"
            cwd={cwd.trim() || null}
            autoFocus
            placeholder="Ask Shelley to build, fix bugs, explore… (@ for files)"
            submitLabel="Start"
            controls={
              <>
                <ModelPicker models={models} value={model} onChange={setModel} withDefault />
                {selectedModel?.supports_reasoning !== false && (
                  <ReasoningPicker
                    value={thinking}
                    onChange={(v) => setThinking(v as ThinkingLevel | "default")}
                  />
                )}
              </>
            }
            onSend={(message) => start(message)}
          />
          {cwdError && (
            <p className="text-destructive px-3 text-xs" role="alert">
              {cwdError}
            </p>
          )}
        </div>
        <RecentTasks rows={rows} models={models} />
      </div>

      <DirectoryBrowser open={browsing} start={cwd} onPick={pickDir} onOpenChange={setBrowsing} />
    </div>
  );
}
