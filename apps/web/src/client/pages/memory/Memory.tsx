/**
 * Memory page (issue #22 phase C, PRD 5.6): what every bot knows about the
 * owner, grouped by category, searchable across bots. Per-bot sections carry
 * the memory on/off switch; rows show their source ("From chat · 2 days ago"
 * vs "Added manually"), supersession, and expiry. Deleted rows never come
 * back (the server tombstones the text), so the page's delete is final.
 */
import { useEffect, useMemo, useState } from "react";
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
import { PageLayout } from "@groot/shell/components/layout/PageLayout";
import { formatRelativeTime } from "@groot/shell/lib/date.utils";
import { Switch } from "../../components/ui/switch";
import type { BotListEntry } from "../../../shared/api/bots";
import type { MemoryCategory, MemoryRecord } from "../../../shared/api/memories";
import { CATEGORY_ORDER } from "../../lib/bots-api";
import { errorMessage } from "../../lib/errors";
import {
  useMemories,
  useMemoryEnabled,
  useMemoryMutations,
  useSetMemoryEnabled,
} from "../../queries/memory";

const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  preference: "Preferences",
  fact: "Facts",
  goal: "Goals",
  habit: "Habits",
};

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
  const { data, loadError, refresh } = useMemories();
  const bots = data?.bots ?? null;
  const memories = useMemo(() => data?.memories ?? {}, [data]);
  const memoryEnabled = useMemoryEnabled(bots ?? []);
  const setMemoryEnabled = useSetMemoryEnabled();
  const mutations = useMemoryMutations();
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{
    botId: string;
    botName: string;
    memory: MemoryRecord | null;
  } | null>(null);
  const [archivedOpen, setArchivedOpen] = useState<Record<string, boolean>>({});
  const confirm = useConfirm();

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
    setMemoryEnabled(botId, on);
    void act(botId, () => mutations.setEnabled.mutateAsync({ botId, on }), "toggle").then((ok) => {
      if (!ok) setMemoryEnabled(botId, !on);
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
    if (await act(memory.id, () => mutations.remove.mutateAsync(memory.id), "remove")) {
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

  // Bots with memories come first, most first; bots without any fold into one
  // compact list at the end instead of a "Nothing yet" section each (#95).
  const countOf = (botId: string) =>
    (filtered.get(botId) ?? []).filter((row) => row.status === "active").length;
  const listed = (bots ?? []).filter((bot) => filtered.has(bot.id));
  const withMemories = listed
    .filter((bot) => (filtered.get(bot.id) ?? []).length > 0)
    .map((bot, index) => ({ bot, index }))
    .sort((a, b) => countOf(b.bot.id) - countOf(a.bot.id) || a.index - b.index)
    .map(({ bot }) => bot);
  const withoutMemories = searching
    ? []
    : listed.filter((bot) => (filtered.get(bot.id) ?? []).length === 0);

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
        <>
          {withMemories.map((bot) => (
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
          ))}
          {withoutMemories.length > 0 && (
            <section aria-label="Bots without memories">
              <h2 className="text-sm font-medium">No memories yet</h2>
              <p className="text-muted-foreground mt-1 text-xs">
                These bots pick things up as you chat with them, or you can add a memory yourself.
                Each bot keeps its own memories.
              </p>
              <ul className="mt-2 divide-y rounded-xl border">
                {withoutMemories.map((bot) => (
                  <li key={bot.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 truncate text-sm">{bot.name}</span>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setEditor({ botId: bot.id, botName: bot.name, memory: null })
                        }
                        aria-label={`Add memory for ${bot.name}`}
                      >
                        <Plus className="size-3.5" />
                        Add
                      </Button>
                      <MemorySwitch
                        botName={bot.name}
                        memoryEnabled={memoryEnabled[bot.id]}
                        busy={busyId !== null && busyId.startsWith(bot.id)}
                        onToggle={(on) => toggleMemory(bot.id, on)}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
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
          <MemorySwitch
            botName={bot.name}
            memoryEnabled={memoryEnabled}
            busy={busy}
            onToggle={onToggle}
          />
        </div>
      </div>
      {!memoryEnabled && (
        <p className="mt-1 text-xs text-muted-foreground">
          Off. This bot no longer learns from chats or uses what it knows.
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
  const [restore, setRestore] = useState(false);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { create, update } = useMemoryMutations();

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
    setRestore(editor.memory !== null && INACTIVE_STATUSES.has(editor.memory.status));
  }, [editor, loadedKey]);

  const save = async () => {
    if (!editor || !text.trim()) return;
    setSaving(true);
    const trimmed = text.trim();
    try {
      if (editor.memory) {
        // Restored memories must not immediately expire again. Ordinary edits
        // leave any automatically captured expiry unchanged.
        const clearExpiry =
          restore && editor.memory.until !== null && new Date(editor.memory.until) <= new Date();
        await update.mutateAsync({
          id: editor.memory.id,
          input: {
            text: trimmed,
            category,
            ...(clearExpiry ? { until: null } : {}),
            ...(restore ? { restore: true } : {}),
          },
        });
        toast.success("Memory saved");
      } else {
        await create.mutateAsync({ botId: editor.botId, input: { text: trimmed, category } });
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
              <SelectContent position="popper" className="max-h-72">
                {CATEGORY_ORDER.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

/** Whether a bot learns from chats; the visible label says what it controls (#95). */
function MemorySwitch({
  botName,
  memoryEnabled,
  busy,
  onToggle,
}: {
  botName: string;
  memoryEnabled: boolean | undefined;
  busy: boolean;
  onToggle: (on: boolean) => void;
}) {
  const on = memoryEnabled ?? true;
  return (
    <label className="text-muted-foreground flex items-center gap-2 text-xs">
      <span aria-hidden>{on ? "Learns from chats" : "Not learning"}</span>
      <Switch
        checked={on}
        disabled={busy}
        onCheckedChange={onToggle}
        aria-label={on ? `Turn off memory for ${botName}` : `Turn on memory for ${botName}`}
      />
    </label>
  );
}
