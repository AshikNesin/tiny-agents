/**
 * Start a Shelley conversation (issue #143): the task, a working directory
 * (recent ones, a folder browser, validated by Shelley), optionally a fresh
 * git worktree so parallel tasks on one repo don't collide, and the model and
 * reasoning level.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronUp, Folder, FolderGit2, GitBranchPlus } from "lucide-react";
import { Button, Input, Text, monoClass } from "@groot/ui";
import { Checkbox } from "@groot/ui/checkbox";
import { Label } from "@groot/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@groot/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@groot/ui/dialog";
import { cn } from "@groot/ui/lib/utils";
import { Spinner } from "../../components/ui/spinner";
import {
  THINKING_LEVELS,
  shelleyApi,
  shortPath,
  type DirectoryListing,
  type ShelleyConversation,
  type ShelleyModel,
  type ThinkingLevel,
} from "../../lib/shelley/api";
import { Composer } from "./Composer";
import { loadModels } from "./ConversationView";

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

export function NewConversation({ rows }: { rows: ShelleyConversation[] }) {
  const navigate = useNavigate();
  const [cwd, setCwd] = useState(() => read(CWD_KEY));
  const [cwdError, setCwdError] = useState<string | null>(null);
  const [worktree, setWorktree] = useState(false);
  const [models, setModels] = useState<ShelleyModel[]>([]);
  const [model, setModel] = useState(() => read(MODEL_KEY, "default"));
  const [thinking, setThinking] = useState<ThinkingLevel | "default">(
    () => read(THINKING_KEY, "default") as ThinkingLevel | "default",
  );
  const [browsing, setBrowsing] = useState(false);

  useEffect(() => {
    void loadModels()
      .then((list) => {
        const ready = list.filter((m) => m.ready);
        setModels(ready);
        setModel((current) =>
          current === "default" || ready.some((m) => m.id === current) ? current : "default",
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
      if (list.length >= 6) break;
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
      ...(model !== "default" ? { model } : {}),
      ...(thinking !== "default" ? { thinkingLevel: thinking } : {}),
    });
    navigate(`/code/${conversationId}`);
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col justify-center gap-4 p-4">
      <div>
        <h2>
          <Text variant="title">New Shelley conversation</Text>
        </h2>
        <p className="text-muted-foreground text-sm">
          Describe the task. Shelley works in the directory you pick; you can steer it while it
          runs.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="code-cwd">Working directory</Label>
        <div className="flex gap-2">
          <Input
            id="code-cwd"
            value={cwd}
            onChange={(e) => {
              setCwd(e.target.value);
              setCwdError(null);
            }}
            onBlur={() => void validate(cwd)}
            placeholder="/home/exedev/repo (Shelley's default when empty)"
            className={cn("flex-1", monoClass)}
            aria-invalid={cwdError ? true : undefined}
          />
          <Button variant="outline" onClick={() => setBrowsing(true)} aria-label="Browse folders">
            <FolderGit2 />
            Browse
          </Button>
        </div>
        {cwdError && <p className="text-destructive text-xs">{cwdError}</p>}
        {recent.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {recent.map((dir) => (
              <button
                key={dir}
                type="button"
                onClick={() => {
                  setCwd(dir);
                  setCwdError(null);
                }}
                title={dir}
                className={cn(
                  "border-border hover:bg-muted rounded-full border px-2.5 py-0.5 text-xs",
                  dir === cwd && "bg-muted",
                  monoClass,
                )}
              >
                {shortPath(dir)}
              </button>
            ))}
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={worktree}
            onCheckedChange={(v) => setWorktree(v === true)}
            disabled={!cwd.trim()}
          />
          <GitBranchPlus className="text-muted-foreground size-4" />
          Work in a new git worktree (parallel tasks on one repo)
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <Select value={model} onValueChange={setModel}>
          <SelectTrigger className="min-w-48 flex-1" aria-label="Model">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Default model</SelectItem>
            {models.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.display_name || m.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={thinking} onValueChange={(v) => setThinking(v as ThinkingLevel | "default")}>
          <SelectTrigger className="w-40" aria-label="Reasoning">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Default reasoning</SelectItem>
            {THINKING_LEVELS.map((l) => (
              <SelectItem key={l} value={l}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Composer
        draftKey="new"
        cwd={cwd.trim() || null}
        autoFocus
        placeholder="What should Shelley build or fix? @ for files"
        submitLabel="Start"
        onSend={(message) => start(message)}
      />

      <DirectoryBrowser
        open={browsing}
        start={cwd}
        onPick={(p) => setCwd(p)}
        onOpenChange={setBrowsing}
      />
    </div>
  );
}
