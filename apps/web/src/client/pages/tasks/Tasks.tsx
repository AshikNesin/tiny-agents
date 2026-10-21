import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CalendarDays,
  CheckCircle2,
  Circle,
  CircleDot,
  Flag,
  ListTodo,
  Plus,
  Trash2,
} from "lucide-react";
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
import { EmptyState } from "@groot/ui/empty-state";
import { Card } from "@groot/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@groot/ui/select";
import { cn } from "@groot/ui/lib/utils";
import { PageLayout } from "@groot/shell/components/layout/PageLayout";
import { tasksApi, type Task, type TaskInput } from "../../lib/tasks-api";
import { formatRelativeTime } from "@groot/shell/lib/date.utils";

type Tab = "today" | "upcoming" | "completed";

const TAB_LABELS: Record<Tab, string> = {
  today: "Today",
  upcoming: "Upcoming",
  completed: "Completed",
};

/** Today bucket: due by end of local day, or undated but in progress. */
function isToday(task: Task, todayEnd: number): boolean {
  if (task.status === "done") return false;
  if (task.dueAt) return new Date(task.dueAt).getTime() <= todayEnd;
  return task.status === "in_progress";
}

function endOfLocalDay(): number {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

const PRIORITY_CLASSES: Record<Task["priority"], string> = {
  low: "",
  medium: "",
  high: "font-medium",
  urgent: "text-destructive",
};

function formatDue(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    ...(d.getHours() || d.getMinutes() ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function Tasks() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("today");
  const [editing, setEditing] = useState<Task | null>(null);
  const [quick, setQuick] = useState("");

  const refresh = useCallback(async () => {
    try {
      setTasks(await tasksApi.list());
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load tasks");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const todayEnd = useMemo(() => endOfLocalDay(), []);

  const sections = useMemo(() => {
    const open = (tasks ?? []).filter((t) => t.status !== "done");
    return {
      today: open.filter((t) => isToday(t, todayEnd)),
      upcoming: open.filter((t) => !isToday(t, todayEnd)),
      completed: (tasks ?? [])
        .filter((t) => t.status === "done")
        .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")),
    };
  }, [tasks, todayEnd]);

  const create = async (title: string, dueToday: boolean) => {
    try {
      await tasksApi.create({
        title,
        // Quick-add on the Upcoming tab defaults to tomorrow EOD (friction
        // #36): an undated task lands in no bucket and renders an empty
        // metadata row. Tomorrow keeps it visibly "upcoming" with a date.
        ...(!dueToday ? { dueAt: new Date(todayEnd + 86_400_000).toISOString() } : {}),
      });
      setQuick("");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add task");
    }
  };

  const toggle = async (task: Task) => {
    const status = task.status === "done" ? "todo" : "done";
    // Optimistic flip; revert on failure.
    setTasks((prev) => prev?.map((t) => (t.id === task.id ? { ...t, status } : t)) ?? prev);
    try {
      await tasksApi.update(task.id, { status });
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update task");
      await refresh();
    }
  };

  const remove = async (id: string) => {
    try {
      await tasksApi.remove(id);
      toast.success("Task deleted");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete task");
    }
  };

  const list = sections[tab];
  const now = Date.now();

  return (
    <PageLayout
      title="Tasks"
      description="Your to-dos. Bots can manage these from chat too."
      maxWidth="4xl"
    >
      {/* Tabs (PRD §6.5: small uppercase section labels with counts) */}
      <div role="tablist" aria-label="Task filters" className="flex gap-1 rounded-lg bg-muted p-1">
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-sm font-medium",
              tab === t
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {TAB_LABELS[t]}
            <span className="text-muted-foreground ml-1.5 text-xs">{sections[t].length}</span>
          </button>
        ))}
      </div>

      {tab !== "completed" && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const title = quick.trim();
            if (title) void create(title, tab === "today");
          }}
        >
          <Input
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            placeholder={tab === "today" ? "Add a task for today" : "Add a task for tomorrow"}
            maxLength={300}
            aria-label="New task title"
          />
          <Button type="submit" size="lg" disabled={!quick.trim()} aria-label="Add task">
            <Plus className="size-4" />
            <span className="hidden sm:inline">Add</span>
          </Button>
        </form>
      )}

      {loadError ? (
        <EmptyState
          icon={ListTodo}
          title="Couldn't load tasks"
          description={loadError}
          variant="destructive"
          action={
            <Button variant="outline" onClick={() => void refresh()}>
              Retry
            </Button>
          }
        />
      ) : tasks === null ? (
        <p className="text-muted-foreground py-8 text-center text-sm">Loading…</p>
      ) : list.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title={tab === "completed" ? "Nothing completed yet" : "All clear"}
          description={
            tab === "today"
              ? "Nothing due today. Enjoy the calm, or plan ahead."
              : tab === "upcoming"
                ? "No upcoming tasks."
                : "Completed tasks will appear here."
          }
        />
      ) : (
        <Card className="divide-y overflow-hidden p-0">
          <ul role="list">
            {list.map((task) => {
              const overdue =
                task.status !== "done" && task.dueAt && new Date(task.dueAt).getTime() < now;
              return (
                <li key={task.id} className="hover:bg-muted/40 flex items-start gap-3 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => void toggle(task)}
                    className="text-muted-foreground hover:text-primary mt-0.5"
                    aria-label={
                      task.status === "done"
                        ? `Mark "${task.title}" as not done`
                        : `Complete "${task.title}"`
                    }
                  >
                    {task.status === "done" ? (
                      <CheckCircle2 className="text-primary size-5" />
                    ) : task.status === "in_progress" ? (
                      <CircleDot className="size-5" />
                    ) : (
                      <Circle className="size-5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(task)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p
                      className={cn(
                        "text-[15px] leading-6",
                        task.status === "done" && "text-muted-foreground line-through",
                      )}
                    >
                      {task.title}
                    </p>
                    <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      {task.dueAt && (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1",
                            overdue && "font-medium text-destructive",
                          )}
                        >
                          <CalendarDays className="size-3" />
                          {overdue ? "Overdue · " : ""}
                          {formatDue(task.dueAt)}
                        </span>
                      )}
                      {task.description && (
                        <span className="max-w-[16rem] truncate">{task.description}</span>
                      )}
                      {task.status === "done" && task.completedAt && (
                        <span>Done {formatRelativeTime(task.completedAt)}</span>
                      )}
                    </div>
                  </button>
                  {(task.priority === "high" || task.priority === "urgent") &&
                    task.status !== "done" && (
                      <span
                        className={cn(
                          "mt-1 inline-flex items-center gap-1 text-xs font-medium capitalize",
                          PRIORITY_CLASSES[task.priority],
                        )}
                      >
                        <Flag className="size-3" />
                        {task.priority}
                      </span>
                    )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <TaskEditor
        task={editing}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await refresh();
        }}
        onDelete={remove}
      />
    </PageLayout>
  );
}

const STATUS_OPTIONS: { value: Task["status"]; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
];

const PRIORITY_OPTIONS: { value: Task["priority"]; label: string }[] = (
  ["low", "medium", "high", "urgent"] as const
).map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }));

function TaskEditor({
  task,
  onClose,
  onSaved,
  onDelete,
}: {
  task: Task | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
}) {
  const [form, setForm] = useState({
    title: "",
    description: "",
    status: "todo" as Task["status"],
    priority: "medium" as Task["priority"],
    due: "",
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (task && task.id !== loadedId) {
    setLoadedId(task.id);
    setForm({
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      due: toLocalInput(task.dueAt),
    });
  }
  if (!task && loadedId !== null) setLoadedId(null);

  const save = async () => {
    if (!task || !form.title.trim()) return;
    setSaving(true);
    const input: TaskInput = {
      title: form.title.trim(),
      description: form.description.trim(),
      status: form.status,
      priority: form.priority,
      dueAt: form.due ? new Date(form.due).toISOString() : null,
    };
    try {
      await tasksApi.update(task.id, input);
      toast.success("Task saved");
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save task");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={!!task && !confirmDelete} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit task</DialogTitle>
            <DialogDescription>Changes apply immediately.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="task-title">Title</Label>
              <Input
                id="task-title"
                value={form.title}
                maxLength={300}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-desc">Notes</Label>
              <Textarea
                id="task-desc"
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm({ ...form, status: v as Task["status"] })}
                >
                  <SelectTrigger aria-label="Task status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" className="max-h-72">
                    {STATUS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select
                  value={form.priority}
                  onValueChange={(v) => setForm({ ...form, priority: v as Task["priority"] })}
                >
                  <SelectTrigger aria-label="Task priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" className="max-h-72">
                    {PRIORITY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-due">Due</Label>
              <Input
                id="task-due"
                type="datetime-local"
                value={form.due}
                onChange={(e) => setForm({ ...form, due: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter className="sm:justify-between">
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="size-4" /> Delete
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => void save()} disabled={!form.title.trim() || saving}>
                Save
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete task?</DialogTitle>
            <DialogDescription>"{task?.title}" will be permanently deleted.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (task) void onDelete(task.id);
                setConfirmDelete(false);
                onClose();
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
