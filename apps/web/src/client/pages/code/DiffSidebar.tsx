import type { ReactNode } from "react";
import { Files, ListFilter, MessagesSquare, RefreshCw, Search, Trash2, X } from "lucide-react";
import { Button } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@groot/ui/dropdown-menu";
import type { fileCommenting } from "../../lib/code/comments";
import type { FileConversations } from "./PullThreads";
import { OPEN_SEARCH } from "./DiffTree";
import type { FileStatus, WorkspaceFile } from "./workspace-file";

const FILE_STATUS: Record<FileStatus, { letter: string; label: string; tone: string }> = {
  added: { letter: "A", label: "Added", tone: "text-success" },
  modified: { letter: "M", label: "Modified", tone: "text-info" },
  deleted: { letter: "D", label: "Deleted", tone: "text-destructive" },
};

export function Sidebar({
  tab,
  onTab,
  commentCount,
  hidden,
  onHidden,
  onClose,
  scopePicker,
  actions,
  footer,
  children,
}: {
  tab: "files" | "comments";
  onTab(tab: "files" | "comments"): void;
  commentCount: number;
  hidden: Set<FileStatus>;
  onHidden(hidden: Set<FileStatus>): void;
  onClose?: () => void;
  scopePicker?: ReactNode;
  actions: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  const tabButton = (value: "files" | "comments", label: string, icon: ReactNode) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === value}
      aria-label={label}
      title={label}
      onClick={() => onTab(value)}
      className={cn(
        "hover:text-foreground flex h-7 items-center gap-1 rounded-md px-1.5 text-xs",
        tab === value ? "text-foreground bg-muted" : "text-muted-foreground",
      )}
    >
      {icon}
      {value === "comments" && commentCount > 0 && (
        <span className="tabular-nums">{commentCount}</span>
      )}
    </button>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 px-2">
        <div role="tablist" aria-label="Sidebar" className="flex items-center gap-0.5">
          {tabButton("files", "Files", <Files className="size-4" />)}
          {tabButton("comments", "Comments", <MessagesSquare className="size-4" />)}
        </div>
        <span className="flex-1" />
        {tab === "files" && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Search files"
              title="Search files"
              className="text-muted-foreground"
              onClick={() => window.dispatchEvent(new Event(OPEN_SEARCH))}
            >
              <Search />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Filter by status"
                    title="Filter by status"
                    className={cn(hidden.size > 0 ? "text-foreground" : "text-muted-foreground")}
                  />
                }
              >
                <ListFilter />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Show files</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {(["added", "modified", "deleted"] as const).map((status) => (
                  <DropdownMenuCheckboxItem
                    key={status}
                    checked={!hidden.has(status)}
                    onCheckedChange={(on) => {
                      const next = new Set(hidden);
                      if (on) next.delete(status);
                      else next.add(status);
                      onHidden(next);
                    }}
                    onSelect={(e) => e.preventDefault()}
                  >
                    <span className={cn("w-3 font-medium", FILE_STATUS[status].tone)}>
                      {FILE_STATUS[status].letter}
                    </span>
                    {FILE_STATUS[status].label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
        {onClose && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close files"
            className="text-muted-foreground"
            onClick={onClose}
          >
            <X />
          </Button>
        )}
      </div>
      {scopePicker && <div className="px-2 pb-1">{scopePicker}</div>}
      {actions && <div className="flex flex-wrap items-center gap-1 px-2 pb-2">{actions}</div>}
      <div
        className="flex min-h-0 flex-1 flex-col"
        role="tabpanel"
        aria-label={tab === "files" ? "Changed files" : "Comments"}
      >
        {children}
      </div>
      {footer}
    </div>
  );
}

export function DiffStats({
  files,
  viewed,
  additions,
  deletions,
  onRefresh,
}: {
  files: number;
  viewed: number | null;
  additions: number;
  deletions: number;
  onRefresh(): void;
}) {
  const row = (label: string, value: ReactNode) => (
    <div className="border-border flex items-center justify-between border-t py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
  return (
    <section
      aria-label="Diff stats"
      className="border-border shrink-0 border-t px-3 pt-2 pb-3 text-xs"
    >
      <div className="flex items-center justify-between pb-1">
        <h2 className="text-muted-foreground font-medium">Diff stats</h2>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onRefresh}
          aria-label="Refresh changes"
          title="Refresh changes"
          className="text-muted-foreground"
        >
          <RefreshCw />
        </Button>
      </div>
      <dl>
        {row("Files", files)}
        {viewed !== null && row("Viewed", `${viewed} of ${files}`)}
        {row("Additions", <span className="text-success">{additions.toLocaleString()}</span>)}
        {row("Deletions", <span className="text-destructive">{deletions.toLocaleString()}</span>)}
      </dl>
    </section>
  );
}

export function CommentList({
  files,
  perFile,
  conversations,
  onJump,
}: {
  files: WorkspaceFile[];
  perFile: Map<string, ReturnType<typeof fileCommenting>>;
  conversations?: (path: string) => FileConversations;
  onJump(path: string, line?: { side: "old" | "new"; line: number }): void;
}) {
  const groups = files
    .map((f) => ({
      file: f,
      comments: perFile.get(f.path)?.comments ?? [],
      remove: perFile.get(f.path)?.onRemoveComment,
      threads: conversations?.(f.path),
    }))
    .filter((g) => g.comments.length > 0 || (g.threads?.notes.length ?? 0) > 0 || g.threads?.aside);
  if (groups.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-xs">
        <MessagesSquare className="size-5" aria-hidden />
        <p className="text-foreground font-medium">No comments yet</p>
        <p>Select line numbers, or the + beside a line, to comment.</p>
      </div>
    );
  }
  return (
    <ul className="min-h-0 flex-1 overflow-y-auto px-1 pb-2" aria-label="Comments by file">
      {groups.map(({ file, comments, remove, threads }) => (
        <li key={file.path} className="py-1">
          <button
            type="button"
            onClick={() => onJump(file.path)}
            className={cn(
              "text-muted-foreground hover:text-foreground w-full truncate px-2 py-1 text-left text-xs font-medium",
            )}
            title={file.path}
          >
            {file.path}
          </button>
          <ul>
            {comments.map((c) => (
              <li key={c.id} className="group flex items-start gap-1">
                <button
                  type="button"
                  onClick={() => onJump(file.path, { side: c.side, line: c.endLine })}
                  className="hover:bg-muted flex min-w-0 flex-1 flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-xs"
                >
                  <span className="text-muted-foreground tabular-nums">
                    {c.side === "old" ? "Removed line" : "Line"}{" "}
                    {c.startLine === c.endLine ? c.startLine : `${c.startLine}–${c.endLine}`}
                    {" · "}
                    {("tag" in c && typeof c.tag === "string" ? c.tag : null) ?? "Not sent"}
                  </span>
                  <span className="line-clamp-2">{c.body}</span>
                </button>
                {remove && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Remove comment"
                    className="text-muted-foreground mt-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => remove(c.id)}
                  >
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
            {threads?.notes.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => onJump(file.path, { side: n.side, line: n.line })}
                  className="hover:bg-muted flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs"
                >
                  <MessagesSquare className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">
                    Conversation on {n.side === "old" ? "removed line" : "line"} {n.line}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {threads?.aside}
        </li>
      ))}
    </ul>
  );
}
