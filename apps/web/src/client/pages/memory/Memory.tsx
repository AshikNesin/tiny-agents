/**
 * Memory page (issue #22 phase C, PRD 5.6): what every bot knows about the
 * owner, grouped by category, searchable across bots. Per-bot sections carry
 * the memory on/off switch; rows show their source ("From chat · 2 days ago"
 * vs "Added manually"), supersession, and expiry. Deleted rows never come
 * back (the server tombstones the text), so the page's delete is final.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Brain, Pencil, Plus, Search, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@groot/ui/dialog";
import { Button } from "@groot/ui/button";
import { Input } from "@groot/ui/input";
import { Textarea } from "@groot/ui/textarea";
import { Label } from "@groot/ui/label";
import { Card } from "@groot/ui/card";
import { EmptyState, ErrorState } from "@groot/ui/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@groot/ui/select";
import { SkeletonList } from "@groot/ui/loading-skeleton";
import { metaLabelClass } from "@groot/ui/typography";
import { cn } from "@groot/ui/lib/utils";
import { useConfirm } from "@groot/ui/primitives";
import { PageLayout } from "@groot/shell/components/layout";
import { formatRelativeTime } from "@groot/shell/lib/date.utils";
import { Switch } from "../../components/ui/switch";
import {
  botsApi,
  CATEGORY_ORDER,
  type BotListEntry,
  type MemoryCategory,
  type MemoryInput,
  type MemoryRecord,
} from "../../lib/bots-api";

const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  preference: "Preferences",
  fact: "Facts",
  goal: "Goals",
  habit: "Habits",
};

/** Prefer the server's error message (Boom) over axios's generic text. */
function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "response" in error) {
    const message = (error as { response?: { data?: { error?: { message?: string } } } }).response
      ?.data?.error?.message;
    if (message) return message;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

interface MemoryGroup {
  category: MemoryCategory | "archived";
  rows: MemoryRecord[];
}

/** Rows grouped under category headers in display order, archived last. */
function groupMemories(rows: MemoryRecord[]): MemoryGroup[] {
  const groups: MemoryGroup[] = CATEGORY_ORDER.map((category) => ({ category, rows: [] }));
  const archived: MemoryGroup = { category: "archived", rows: [] };
  for (const row of rows) {
    if (row.status === "archived") archived.rows.push(row);
    else groups.find((g) => g.category === row.category)?.rows.push(row);
  }
  return [
    ...groups.filter((g) => g.rows.length > 0),
    ...(archived.rows.length > 0 ? [archived] : []),
  ];
}

export function MemoryPage() {
  const [bots, setBots] = useState<BotListEntry[] | null>(null);
  const [memoryEnabled, setMemoryEnabled] = useState<Record<string, boolean | undefined>>({});
  const [memories, setMemories] = useState<Record<string, MemoryRecord[]>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{
    botId: string;
    botName: string;
    memory: MemoryRecord | null;
  } | null>(null);
  const [archivedOpen, setArchivedOpen] = useState<Record<string, boolean>>({});
  const confirm = useConfirm();

  const refresh = useCallback(async () => {
    try {
      const list = await botsApi.list();
      const lists = await Promise.all(list.map((bot) => botsApi.listMemories(bot.id)));
      setBots(list);
      setMemories(Object.fromEntries(list.map((bot, i) => [bot.id, lists[i].memories])));
      setLoadError(null);
    } catch (error) {
      setLoadError(errorMessage(error, "Failed to load memories"));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The list endpoint carries no memoryEnabled, so each bot's switch reads
  // the full bot once and lives in local state afterwards.
  useEffect(() => {
    if (bots === null) return;
    for (const bot of bots) {
      if (bot.id in memoryEnabled) continue;
      botsApi
        .get(bot.id)
        .then((full) => setMemoryEnabled((prev) => ({ ...prev, [bot.id]: full.memoryEnabled })))
        .catch(() => setMemoryEnabled((prev) => ({ ...prev, [bot.id]: true })));
    }
  }, [bots, memoryEnabled]);

  const act = async (id: string, action: () => Promise<unknown>, pending: string) => {
    setBusyId(id + pending);
    try {
      await action();
      await refresh();
      return true;
    } catch (error) {
      toast.error(errorMessage(error, "Memory action failed"));
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const toggleMemory = (botId: string, on: boolean) => {
    setMemoryEnabled((prev) => ({ ...prev, [botId]: on }));
    void act(botId, () => botsApi.update(botId, { memoryEnabled: on }), "toggle").then((ok) => {
      if (!ok) setMemoryEnabled((prev) => ({ ...prev, [botId]: !on }));
    });
  };

  const remove = async (memory: MemoryRecord) => {
    const confirmed = await confirm({
      title: "Delete this memory?",
      description: `"${memory.text}" is removed from the bot's knowledge and never captured again.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    if (await act(memory.id, () => botsApi.deleteMemory(memory.id), "remove")) {
      toast.success("Memory deleted");
    }
  };

  const searching = query.trim() !== "";
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byBot = new Map<string, MemoryRecord[]>();
    for (const [botId, rows] of Object.entries(memories)) {
      const hits = q ? rows.filter((row) => row.text.toLowerCase().includes(q)) : rows;
      // Not searching: every bot keeps its section, even with zero rows, so
      // an empty bot still offers its switch and Add button.
      if (hits.length > 0 || !q) byBot.set(botId, hits);
    }
    return byBot;
  }, [memories, query]);

  return (
    <PageLayout
      title="Memory"
      description="What each bot remembers about you. Bots learn from chats; you can add, edit, or remove anything."
      maxWidth="4xl"
    >
      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search memories across bots"
        aria-label="Search memories"
        maxLength={200}
      />

      {loadError ? (
        <ErrorState
          title="Couldn't load memories"
          description={loadError}
          action={
            <Button variant="outline" onClick={() => void refresh()}>
              Retry
            </Button>
          }
        />
      ) : bots === null ? (
        <SkeletonList rows={3} leading="circle" secondaryLine />
      ) : bots.length === 0 ? (
        <EmptyState
          icon={Brain}
          title="No bots yet"
          description="Create a bot first; its memories will appear here."
        />
      ) : searching && filtered.size === 0 ? (
        <EmptyState
          icon={Search}
          title="No matching memories"
          description={`Nothing matches "${query.trim()}". Try a different search.`}
        />
      ) : (
        bots
          .filter((bot) => filtered.has(bot.id))
          .map((bot) => (
            <BotMemorySection
              key={bot.id}
              bot={bot}
              rows={filtered.get(bot.id) ?? []}
              memoryEnabled={memoryEnabled[bot.id]}
              busy={busyId !== null && busyId.startsWith(bot.id)}
              archivedOpen={archivedOpen[bot.id] ?? false}
              onArchivedOpen={(open) => setArchivedOpen((prev) => ({ ...prev, [bot.id]: open }))}
              onToggle={(on) => toggleMemory(bot.id, on)}
              onAdd={() => setEditor({ botId: bot.id, botName: bot.name, memory: null })}
              onEdit={(memory) => setEditor({ botId: bot.id, botName: bot.name, memory })}
              onDelete={(memory) => void remove(memory)}
            />
          ))
      )}

      <MemoryEditor
        editor={editor}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
        onSaved={async () => {
          setEditor(null);
          await refresh();
        }}
      />
    </PageLayout>
  );
}

function BotMemorySection({
  bot,
  rows,
  memoryEnabled,
  busy,
  archivedOpen,
  onArchivedOpen,
  onToggle,
  onAdd,
  onEdit,
  onDelete,
}: {
  bot: BotListEntry;
  rows: MemoryRecord[];
  memoryEnabled: boolean | undefined;
  busy: boolean;
  archivedOpen: boolean;
  onArchivedOpen: (open: boolean) => void;
  onToggle: (on: boolean) => void;
  onAdd: () => void;
  onEdit: (memory: MemoryRecord) => void;
  onDelete: (memory: MemoryRecord) => void;
}) {
  const groups = useMemo(() => groupMemories(rows), [rows]);
  const archived = groups.find((g) => g.category === "archived");
  const visible = groups.filter((g) => g.category !== "archived");
  const activeCount = rows.filter((r) => r.status === "active").length;

  return (
    <section aria-label={`${bot.name} memories`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-sm font-medium">{bot.name}</h2>
          <span className="text-xs text-muted-foreground">
            {activeCount === 1 ? "1 memory" : `${activeCount} memories`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onAdd}>
            <Plus className="size-3.5" />
            Add memory
          </Button>
          <Switch
            checked={memoryEnabled ?? true}
            disabled={busy}
            onCheckedChange={onToggle}
            aria-label={
              memoryEnabled ? `Turn off memory for ${bot.name}` : `Turn on memory for ${bot.name}`
            }
          />
        </div>
      </div>
      {!memoryEnabled && (
        <p className="mt-1 text-xs text-muted-foreground">
          Off — this bot no longer learns from chats or uses what it knows.
        </p>
      )}
      <div className="mt-3 space-y-4">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing yet. Chat with {bot.name} and it picks things up, or add a memory yourself.
          </p>
        ) : (
          <>
            {visible.map((group) => (
              <div key={group.category}>
                <h3 className={cn(metaLabelClass, "mb-1.5")}>
                  {group.category !== "archived" && CATEGORY_LABELS[group.category]}
                  <span className="ml-1.5 font-normal">{group.rows.length}</span>
                </h3>
                <Card className="divide-y overflow-hidden p-0">
                  <ul role="list">
                    {group.rows.map((memory) => (
                      <MemoryRow
                        key={memory.id}
                        memory={memory}
                        onEdit={() => onEdit(memory)}
                        onDelete={() => onDelete(memory)}
                      />
                    ))}
                  </ul>
                </Card>
              </div>
            ))}
            {archived && (
              <div>
                <button
                  type="button"
                  onClick={() => onArchivedOpen(!archivedOpen)}
                  aria-expanded={archivedOpen}
                  className={cn(metaLabelClass, "hover:text-foreground flex items-center gap-2")}
                >
                  <span className={cn("transition-transform", archivedOpen && "rotate-90")}>›</span>
                  Archived
                  <span className="font-normal">{archived.rows.length}</span>
                </button>
                {archivedOpen && (
                  <Card className="mt-1.5 divide-y overflow-hidden p-0">
                    <ul role="list">
                      {archived.rows.map((memory) => (
                        <MemoryRow
                          key={memory.id}
                          memory={memory}
                          onEdit={() => onEdit(memory)}
                          onDelete={() => onDelete(memory)}
                        />
                      ))}
                    </ul>
                  </Card>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function MemoryRow({
  memory,
  onEdit,
  onDelete,
}: {
  memory: MemoryRecord;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const inactive = memory.status !== "active";
  return (
    <li className="hover:bg-muted/40 flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-[15px] leading-6",
            memory.status === "superseded" && "text-muted-foreground line-through",
            inactive && memory.status !== "superseded" && "text-muted-foreground",
          )}
        >
          {memory.text}
        </p>
        <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span>
            {memory.source === "capture"
              ? `From chat · ${formatRelativeTime(memory.createdAt)}`
              : "Added manually"}
          </span>
          {memory.status === "superseded" && <span>superseded</span>}
          {memory.status === "expired" && <span>expired</span>}
          {memory.until !== null && memory.status === "active" && (
            <span>until {formatRelativeTime(memory.until)}</span>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onEdit}
        aria-label={`Edit memory "${memory.text}"`}
      >
        <Pencil className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-destructive"
        onClick={onDelete}
        aria-label={`Delete memory "${memory.text}"`}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </li>
  );
}

const INACTIVE_STATUSES: ReadonlySet<string> = new Set(["superseded", "archived", "expired"]);

/** ISO instant → datetime-local value in the browser's timezone. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function MemoryEditor({
  editor,
  onOpenChange,
  onSaved,
}: {
  editor: { botId: string; botName: string; memory: MemoryRecord | null } | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void | Promise<void>;
}) {
  const [text, setText] = useState("");
  const [category, setCategory] = useState<MemoryCategory>("preference");
  const [until, setUntil] = useState("");
  const [restore, setRestore] = useState(false);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The form resets per dialog open so a create never inherits the
  // previously edited memory's values.
  useEffect(() => {
    if (!editor) {
      setLoadedKey(null);
      return;
    }
    const key = editor.memory?.id ?? `new:${editor.botId}`;
    if (key === loadedKey) return;
    setLoadedKey(key);
    setText(editor.memory?.text ?? "");
    setCategory(editor.memory?.category ?? "preference");
    // datetime-local wants local wall time; the wire wants an instant.
    setUntil(editor.memory?.until ? toLocalInput(editor.memory.until) : "");
    setRestore(editor.memory !== null && INACTIVE_STATUSES.has(editor.memory.status));
  }, [editor, loadedKey]);

  const save = async () => {
    if (!editor || !text.trim()) return;
    setSaving(true);
    const trimmed = text.trim();
    // A restore with the old (past) deadline would flip straight back to
    // expired, so restoring drops a deadline that is already past.
    let nextUntil = until ? new Date(until).toISOString() : null;
    if (restore && nextUntil && new Date(nextUntil) <= new Date()) nextUntil = null;
    try {
      if (editor.memory) {
        await botsApi.updateMemory(editor.memory.id, {
          text: trimmed,
          category,
          until: nextUntil,
          ...(restore ? { restore: true } : {}),
        });
        toast.success("Memory saved");
      } else {
        const input: MemoryInput = {
          text: trimmed,
          category,
          ...(until ? { until: new Date(until).toISOString() } : {}),
        };
        await botsApi.createMemory(editor.botId, input);
        toast.success("Memory added");
      }
      await onSaved();
    } catch (error) {
      toast.error(errorMessage(error, "Failed to save memory"));
    } finally {
      setSaving(false);
    }
  };

  const canRestore = editor?.memory != null && editor.memory.status !== "active";

  return (
    <Dialog open={editor !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editor?.memory ? "Edit memory" : "Add memory"}</DialogTitle>
          <DialogDescription>
            {editor ? `Saved to ${editor.botName}. Changes apply from the bot's next reply.` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="memory-text">Memory</Label>
            <Textarea
              id="memory-text"
              rows={2}
              value={text}
              maxLength={300}
              onChange={(e) => setText(e.target.value)}
              placeholder="One self-contained fact, e.g. Prefers TypeScript over JavaScript"
            />
          </div>
          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as MemoryCategory)}>
              <SelectTrigger aria-label="Category" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_ORDER.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="memory-until">Forgets after</Label>
            <Input
              id="memory-until"
              type="datetime-local"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Optional. Leave empty to keep forever.</p>
          </div>
          {canRestore && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={restore}
                onChange={(e) => setRestore(e.target.checked)}
                className="border-input size-4 rounded"
              />
              Restore to active
            </label>
          )}
        </div>
        <DialogFooter className="sm:justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!text.trim() || saving}>
            {editor?.memory ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
