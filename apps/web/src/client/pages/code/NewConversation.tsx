/**
 * Start a thread (issue #143, ADR 0011): pick the harness (Shelley,
 * Claude Code, …), then one composer for the task, with the harness's
 * model, reasoning and permission chips inside it and, under it, the
 * working directory (searchable: recent ones, a typed path, a folder
 * browser, validated by the harness) and an optional fresh git worktree
 * when the harness makes them.
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
  Layers,
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
  codeApi,
  shortPath,
  threadPath,
  type DirectoryListing,
  type HarnessInfo,
  type ModelOption,
  type PermissionMode,
  type ThreadSummary,
} from "../../lib/code/api";
import { Composer } from "./Composer";
import { DEFAULT, ModelPicker, PermissionPicker, ReasoningPicker, loadModels } from "./controls";

const HARNESS_KEY = "tiny-agents:code-harness";
const key = (harness: string, what: "cwd" | "model" | "effort") =>
  `tiny-agents:code-${what}:${harness}`;

function read(name: string, fallback = ""): string {
  try {
    return window.localStorage.getItem(name) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Remembered per browser: the last harness, and per harness the directory, model and effort. */
function save(name: string, value: string) {
  try {
    window.localStorage.setItem(name, value);
  } catch {
    // not remembered in private mode
  }
}

/** Shelley's settings from before the harness layer carry over once. */
function readLegacy(harness: string, what: "cwd" | "model" | "effort"): string | undefined {
  if (harness !== "shelley") return undefined;
  const legacy = { cwd: "cwd", model: "model", effort: "thinking" }[what];
  try {
    return window.localStorage.getItem(`tiny-agents:shelley-${legacy}`) ?? undefined;
  } catch {
    return undefined;
  }
}

function DirectoryBrowser({
  harness,
  open,
  start,
  onPick,
  onOpenChange,
}: {
  harness: HarnessInfo;
  open: boolean;
  start: string;
  onPick(path: string): void;
  onOpenChange(open: boolean): void;
}) {
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const go = (path?: string) => {
    setError(null);
    codeApi
      .directories(harness.id, path)
      .then(setListing)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  useEffect(() => {
    if (open) go(start || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when opened
  }, [open]);
  const dirs = (listing?.entries ?? []).filter((e) => e.isDir && !e.name.startsWith("."));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Choose a working directory</DialogTitle>
          <DialogDescription>Folders on {harness.label}'s machine.</DialogDescription>
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
              {listing.repoRoot ? " · git" : ""}
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

/** The latest top-level threads under the composer, Cursor-agents style. */
function RecentTasks({ rows, harnesses }: { rows: ThreadSummary[]; harnesses: HarnessInfo[] }) {
  const recent = rows
    .filter((r) => !r.parentId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 6);
  if (recent.length === 0) return null;
  const subagentCount = new Map<string, number>();
  for (const r of rows) {
    if (r.parentId) subagentCount.set(r.parentId, (subagentCount.get(r.parentId) ?? 0) + 1);
  }
  const several = harnesses.length > 1;
  return (
    <section aria-label="Recent threads" className="space-y-1">
      <h2 className={cn(metaLabelClass, "px-2 pb-1")}>Recent</h2>
      <ul className="space-y-px">
        {recent.map((row) => {
          const children = subagentCount.get(row.id) ?? 0;
          const repo = row.repoRoot || row.cwd;
          return (
            <li key={row.id}>
              <Link
                to={threadPath(row.id)}
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
                      {row.title}
                    </span>
                    {row.unread && (
                      <span
                        className="bg-primary size-1.5 shrink-0 rounded-full"
                        aria-label="Unread"
                      />
                    )}
                  </span>
                  <span className="text-muted-foreground flex min-w-0 items-center gap-2 text-xs">
                    {several && (
                      <span className="shrink-0">
                        {harnesses.find((h) => h.id === row.instanceId)?.label ?? row.instanceId}
                      </span>
                    )}
                    {row.working ? (
                      <span>Working</span>
                    ) : (
                      row.model && <span className="truncate">{row.model}</span>
                    )}
                    {repo && (
                      <span className="truncate">{repo.split("/").filter(Boolean).pop()}</span>
                    )}
                    {children > 0 && (
                      <span className="flex shrink-0 items-center gap-0.5">
                        <Bot className="size-3" />
                        {children}
                      </span>
                    )}
                    <span className="shrink-0 tabular-nums">{shortAgo(row.updatedAt)}</span>
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

/** Which harness gets the new thread: the last one used, else the first. */
function initialHarness(harnesses: HarnessInfo[]): string {
  const last = read(HARNESS_KEY);
  return harnesses.find((h) => h.id === last)?.id ?? harnesses[0]?.id ?? "";
}

export function NewConversation({
  rows,
  harnesses,
}: {
  rows: ThreadSummary[];
  harnesses: HarnessInfo[];
}) {
  const navigate = useNavigate();
  const [harnessId, setHarnessId] = useState(() => initialHarness(harnesses));
  const harness = harnesses.find((h) => h.id === harnessId) ?? harnesses[0]!;
  const caps = harness.capabilities;
  const [cwd, setCwd] = useState("");
  const [cwdError, setCwdError] = useState<string | null>(null);
  const [worktree, setWorktree] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [model, setModel] = useState(DEFAULT);
  const [effort, setEffort] = useState(DEFAULT);
  const [permission, setPermission] = useState<PermissionMode | null>(null);
  const [browsing, setBrowsing] = useState(false);

  // Each harness remembers its own directory, model and effort.
  useEffect(() => {
    setCwd(read(key(harness.id, "cwd"), readLegacy(harness.id, "cwd") ?? ""));
    setModel(read(key(harness.id, "model"), readLegacy(harness.id, "model") ?? DEFAULT));
    setEffort(read(key(harness.id, "effort"), readLegacy(harness.id, "effort") ?? DEFAULT));
    setPermission(harness.capabilities.settings.defaultPermissionMode ?? null);
    setWorktree(false);
    setCwdError(null);
    setModels([]);
    void loadModels(harness.id)
      .then((list) => {
        setModels(list);
        const ready = list.filter((m) => m.ready !== false);
        setModel((current) =>
          current === DEFAULT || ready.some((m) => m.id === current) ? current : DEFAULT,
        );
      })
      .catch(() => setModels([]));
  }, [harness]);

  // Recent directories of this harness, most recent first: one click to reuse.
  const recent = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    const mine = rows.filter((r) => r.instanceId === harness.id);
    for (const row of [...mine].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
      const dir = row.cwd;
      if (!dir || seen.has(dir)) continue;
      seen.add(dir);
      list.push(dir);
      if (list.length >= 8) break;
    }
    return list;
  }, [rows, harness.id]);

  // Without worktrees, two threads in one directory share its files: say so.
  const sharing = useMemo(
    () =>
      cwd.trim() && !caps.workspace.worktrees
        ? rows.filter((r) => r.working && r.cwd === cwd.trim() && !r.parentId)
        : [],
    [rows, cwd, caps.workspace.worktrees],
  );

  const validate = async (path: string) => {
    if (!path.trim() || !caps.workspace.browse) {
      setCwdError(null);
      return true;
    }
    try {
      const result = await codeApi.validateCwd(harness.id, path.trim());
      setCwdError(
        result.valid ? null : (result.error ?? `${harness.label} can't use this directory.`),
      );
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

  const start = async (message: string, attachments: string[]) => {
    let dir = cwd.trim();
    if (caps.workspace.requiresCwd && !dir) {
      throw new Error(`Pick a working directory for ${harness.label}.`);
    }
    if (dir && !(await validate(dir))) {
      throw new Error(`Pick a directory ${harness.label} can use.`);
    }
    if (worktree && dir && caps.workspace.worktrees) {
      dir = (await codeApi.createWorktree(harness.id, dir)).path;
    }
    save(HARNESS_KEY, harness.id);
    if (cwd.trim()) save(key(harness.id, "cwd"), cwd.trim());
    save(key(harness.id, "model"), model);
    save(key(harness.id, "effort"), effort);
    const { threadId } = await codeApi.create({
      instanceId: harness.id,
      message,
      ...(dir ? { cwd: dir } : {}),
      ...(model !== DEFAULT ? { model } : {}),
      ...(effort !== DEFAULT ? { effort } : {}),
      ...(permission ? { permissionMode: permission } : {}),
      ...(attachments.length ? { attachments } : {}),
    });
    navigate(threadPath(threadId));
  };

  const selectedModel = models.find((m) => m.id === model) ?? models.find((m) => m.isDefault);
  const dirOptions: SearchSelectOption[] = [
    ...(caps.workspace.requiresCwd
      ? []
      : [
          {
            value: "",
            label: `${harness.label}'s default`,
            description: "Its home directory",
            icon: <Folder className="text-muted-foreground" />,
          },
        ]),
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
        <Button asChild variant="ghost" size="icon-sm" aria-label="All threads">
          <Link to="/code">
            <ArrowLeft />
          </Link>
        </Button>
        <span className="text-sm font-medium">New thread</span>
      </div>
      <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-8 overflow-y-auto px-4 pt-6 pb-8 md:pt-[12vh]">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1 px-1.5" data-testid="code-new-options">
            {harnesses.length > 1 && (
              <SearchSelect
                label="Coding agent"
                value={harness.id}
                onValueChange={setHarnessId}
                options={harnesses.map((h) => ({
                  value: h.id,
                  label: h.label,
                  description:
                    h.status.state === "connected"
                      ? undefined
                      : (h.status.detail ?? h.status.state),
                }))}
                data-testid="code-harness"
              >
                <Layers className="opacity-70" />
                <span>{harness.label}</span>
                <ChevronDown className="opacity-50" />
              </SearchSelect>
            )}
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
              actions={
                caps.workspace.browse
                  ? [
                      {
                        key: "browse",
                        label: "Browse folders…",
                        icon: <FolderOpen className="text-muted-foreground" />,
                        onSelect: () => setBrowsing(true),
                      },
                    ]
                  : []
              }
              triggerClassName={cn(cwdError && "text-destructive")}
              data-testid="code-cwd"
            >
              <FolderGit2 className="opacity-70" />
              <span className={cn("max-w-56 truncate", cwd && monoClass)}>
                {cwd
                  ? shortPath(cwd)
                  : caps.workspace.requiresCwd
                    ? "Pick a working directory"
                    : `${harness.label}'s default directory`}
              </span>
              <ChevronDown className="opacity-50" />
            </SearchSelect>
            {caps.workspace.worktrees && (
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
            )}
          </div>
          <Composer
            key={harness.id}
            draftKey={`new:${harness.id}`}
            harness={harness}
            cwd={cwd.trim() || null}
            autoFocus
            placeholder={`Ask ${harness.label} to build, fix bugs, explore…${caps.workspace.findFiles ? " (@ for files)" : ""}`}
            submitLabel="Start"
            controls={
              <>
                <ModelPicker models={models} value={model} onChange={setModel} withDefault />
                {selectedModel?.supportsReasoning !== false && (
                  <ReasoningPicker
                    levels={caps.settings.effortLevels}
                    value={effort}
                    onChange={setEffort}
                  />
                )}
                {permission && (
                  <PermissionPicker
                    modes={caps.settings.permissionModes}
                    value={permission}
                    onChange={setPermission}
                  />
                )}
              </>
            }
            onSend={(message, { attachments }) => start(message, attachments)}
          />
          {cwdError && (
            <p className="text-destructive px-3 text-xs" role="alert">
              {cwdError}
            </p>
          )}
          {sharing.length > 0 && (
            <p className="text-warning px-3 text-xs" role="status" data-testid="code-cwd-shared">
              {sharing.map((t) => `“${t.title}”`).join(", ")} {sharing.length === 1 ? "is" : "are"}{" "}
              working in this directory now: both threads will edit the same files.
            </p>
          )}
          {harness.status.state !== "connected" && harness.status.detail && (
            <p className="text-muted-foreground px-3 text-xs" role="status">
              {harness.label}: {harness.status.detail}
            </p>
          )}
        </div>
        <RecentTasks rows={rows} harnesses={harnesses} />
      </div>

      {caps.workspace.browse && (
        <DirectoryBrowser
          harness={harness}
          open={browsing}
          start={cwd}
          onPick={pickDir}
          onOpenChange={setBrowsing}
        />
      )}
    </div>
  );
}
