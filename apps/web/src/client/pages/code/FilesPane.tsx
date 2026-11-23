import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Search } from "lucide-react";
import { toast } from "sonner";
import { monoClass } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { Spinner } from "../../components/ui/spinner";
import { projectsApi } from "../../lib/code/projects";
import { useResource } from "../../queries/resource";
import { Kbd } from "../../components/keys";
import { LightEditor } from "./LightEditor";

const SHOWN = 200;

function matches(path: string, query: string): boolean {
  let at = 0;
  const lower = path.toLowerCase();
  for (const letter of query.toLowerCase()) {
    at = lower.indexOf(letter, at);
    if (at < 0) return false;
    at += 1;
  }
  return true;
}

function Results({
  rows,
  active,
  onOpen,
  empty,
}: {
  rows: Array<{ key: string; path: string; detail?: string }>;
  active: string | null;
  onOpen(path: string): void;
  empty: string;
}) {
  if (rows.length === 0) return <p className="text-muted-foreground px-3 py-2 text-xs">{empty}</p>;
  return (
    <ul className="max-h-[38%] shrink-0 overflow-y-auto py-1" data-testid="code-files-list">
      {rows.map((row) => (
        <li key={row.key}>
          <button
            type="button"
            onClick={() => onOpen(row.path)}
            aria-current={row.path === active && !row.detail ? "true" : undefined}
            className={cn(
              "hover:bg-muted flex w-full items-baseline gap-2 px-3 py-0.5 text-left text-xs outline-none focus-visible:bg-muted",
              row.path === active && !row.detail && "bg-muted",
              monoClass,
            )}
          >
            <span className="shrink-0 truncate">{row.path}</span>
            {row.detail && (
              <span className="text-muted-foreground min-w-0 truncate">{row.detail}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function FilesPane({ threadId, refreshKey }: { threadId: string; refreshKey: unknown }) {
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [searched, setSearched] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLInputElement>(null);

  const files = useResource(
    ["code", "files", threadId, refreshKey],
    () => projectsApi.files(threadId),
    "Could not list the files.",
  );
  const hits = useResource(
    ["code", "files", threadId, "search", searched],
    () => projectsApi.searchFiles(threadId, searched),
    "Could not search.",
    { enabled: searched.length >= 2 },
  );
  const file = useResource(
    ["code", "files", threadId, "content", open],
    () => projectsApi.fileContent(threadId, open!),
    "Could not open the file.",
    { enabled: open !== null },
  );

  useEffect(() => {
    const onFocus = (event: Event) => {
      const which = (event as CustomEvent<"name" | "text">).detail;
      (which === "text" ? textInput : nameInput).current?.focus();
    };
    window.addEventListener("code:files-focus", onFocus);
    return () => window.removeEventListener("code:files-focus", onFocus);
  }, []);

  const named = useMemo(
    () => (files.data ?? []).filter((path) => matches(path, name)).slice(0, SHOWN),
    [files.data, name],
  );
  const rows = searched
    ? (hits.data ?? []).map((hit) => ({
        key: `${hit.path}:${hit.line}`,
        path: hit.path,
        detail: `${hit.line}: ${hit.text.trim()}`,
      }))
    : named.map((path) => ({ key: path, path }));

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="code-files">
      <div className="border-border flex shrink-0 flex-wrap gap-2 border-b px-3 py-2">
        <label className="flex min-w-40 flex-1 items-center gap-1.5 text-xs">
          <FileText className="text-muted-foreground size-3.5 shrink-0" />
          <input
            ref={nameInput}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setSearched("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && named[0]) setOpen(named[0]);
            }}
            placeholder="Open a file by name"
            aria-label="Open a file by name"
            className="placeholder:text-fg-tertiary min-w-0 flex-1 bg-transparent outline-none"
          />
          <Kbd keys="p" />
        </label>
        <form
          className="flex min-w-40 flex-1 items-center gap-1.5 text-xs"
          onSubmit={(event) => {
            event.preventDefault();
            setSearched(text.trim());
          }}
        >
          <Search className="text-muted-foreground size-3.5 shrink-0" />
          <input
            ref={textInput}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Search in files"
            aria-label="Search in files"
            className="placeholder:text-fg-tertiary min-w-0 flex-1 bg-transparent outline-none"
          />
          <Kbd keys="s" />
        </form>
      </div>
      {files.loadError ? (
        <p className="text-destructive px-3 py-2 text-xs">{files.loadError}</p>
      ) : !files.data || (searched && !hits.data && !hits.loadError) ? (
        <Spinner className="mx-3 my-2 size-3.5" />
      ) : (
        <Results
          rows={rows}
          active={open}
          onOpen={setOpen}
          empty={searched ? `Nothing contains “${searched}”.` : "No file has that name."}
        />
      )}
      <div className="border-border min-h-0 flex-1 overflow-auto border-t">
        {open === null ? (
          <p className="text-muted-foreground p-3 text-xs">Pick a file to read or edit it.</p>
        ) : file.loadError ? (
          <p className="text-destructive p-3 text-xs">{file.loadError}</p>
        ) : !file.data || file.data.path !== open ? (
          <Spinner className="m-3 size-3.5" />
        ) : file.data.content === null ? (
          <p className="text-muted-foreground p-3 text-xs">
            {open} is binary or too large to show here.
          </p>
        ) : (
          <LightEditor
            key={`${open}:${file.data.content.length}`}
            path={open}
            content={file.data.content}
            onCancel={() => setOpen(null)}
            onSave={async (next) => {
              await projectsApi.editFile(threadId, {
                path: open,
                original: file.data!.content!,
                content: next,
              });
              toast.success(`Saved ${open}`);
              await file.refresh();
            }}
          />
        )}
      </div>
    </div>
  );
}
