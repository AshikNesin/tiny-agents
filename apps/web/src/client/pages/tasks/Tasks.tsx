import { Fragment, useMemo, useState } from "react";
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
import type { Task, TaskUpdateBody } from "../../../shared/api/tasks";
import { useSetTask, useTaskMutations, useTasks } from "../../queries/tasks";
import { formatRelativeTime } from "@groot/shell/lib/date.utils";
import { errorMessage } from "../../lib/errors";
import { parseQuickTask } from "../../lib/task-quick-add";

type Tab = "today" | "upcoming" | "completed";

const TAB_LABELS: Record<Tab, string> = {
  today: "Today",
  upcoming: "Upcoming",
  completed: "Completed",
};

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

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function formatDue(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const allDay =
    (d.getHours() === 23 && d.getMinutes() === 59) || (!d.getHours() && !d.getMinutes());
  const days = Math.round((startOfLocalDay(d) - startOfLocalDay(now)) / 86_400_000);
  const day =
    days === 0
      ? "Today"
      : days === 1
        ? "Tomorrow"
        : days === -1
          ? "Yesterday"
          : d.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
            });
  if (allDay) return day;
  return `${day}, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function Tasks() {
  const resource = useTasks();
  const { refresh } = resource;
  const tasks =
    resource.status === "ready"
      ? resource.data
      : resource.status === "failed"
        ? (resource.last ?? null)
        : null;
  const setTask = useSetTask();
  const mutations = useTaskMutations();
  const [tab, setTab] = useState<Tab>("today");
  const [editing, setEditing] = useState<Task | null>(null);
  const [quick, setQuick] = useState("");

  const todayEnd = useMemo(() => endOfLocalDay(), []);

  const sections = useMemo(() => {
    const open = (tasks ?? []).filter((t) => t.status !== "done");
    return {
      today: open.filter((t) => isToday(t, todayEnd)),
      upcoming: open
        .filter((t) => !isToday(t, todayEnd))
        .sort((a, b) => {
          if (!a.dueAt || !b.dueAt) return a.dueAt ? -1 : b.dueAt ? 1 : 0;
          return a.dueAt.localeCompare(b.dueAt);
        }),
      completed: (tasks ?? [])
        .filter((t) => t.status === "done")
        .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")),
    };
  }, [tasks, todayEnd]);

  const quickPreview = useMemo(() => {
    const parsed = parseQuickTask(quick);
    if (!quick.trim() || (!parsed.due && !parsed.priority)) return "";
    return [
      `"${parsed.title}"`,
      parsed.due ? `due ${formatDue(parsed.due.toISOString())}` : "",
      parsed.priority ? `${parsed.priority} priority` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }, [quick]);

  const create = async (text: string, dueToday: boolean) => {
    const parsed = parseQuickTask(text);
    const due = parsed.due ?? new Date(dueToday ? todayEnd : todayEnd + 86_400_000);
    try {
      await mutations.create.mutateAsync({
        title: parsed.title,
        ...(parsed.priority ? { priority: parsed.priority } : {}),
        dueAt: due.toISOString(),
      });
      setQuick("");
      await refresh();
      const landed: Tab = due.getTime() <= todayEnd ? "today" : "upcoming";
      if (landed !== tab) {
        toast.success(`Added to ${TAB_LABELS[landed]}`, {
          description: `"${parsed.title}" · ${formatDue(due.toISOString())}`,
          action: { label: "Show", onClick: () => setTab(landed) },
        });
      }
    } catch (error) {
      toast.error(errorMessage(error, "Failed to add task"));
    }
  };

  const toggle = async (task: Task) => {
    const status = task.status === "done" ? "todo" : "done";
    setTask(task.id, { status });
    try {
      await mutations.update.mutateAsync({ id: task.id, input: { status } });
      await refresh();
      if (status === "done") {
        toast.success("Task completed", {
          description: task.title,
          action: {
            label: "Undo",
            onClick: () =>
              void mutations.update
                .mutateAsync({ id: task.id, input: { status: task.status } })
                .then(refresh)
                .catch((error: unknown) => toast.error(errorMessage(error, "Couldn't undo"))),
          },
        });
      }
    } catch (error) {
      toast.error(errorMessage(error, "Failed to update task"));
      await refresh();
    }
  };

  const remove = async (id: string) => {
    try {
      await mutations.remove.mutateAsync(id);
      toast.success("Task deleted");
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error, "Failed to delete task"));
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
            placeholder={
              tab === "today"
                ? "Add a task for today (try “tomorrow 5pm !high”)"
                : "Add a task for tomorrow (try “fri 9am”)"
            }
            maxLength={300}
            aria-label="New task title"
          />
          <Button type="submit" size="lg" disabled={!quick.trim()} aria-label="Add task">
            <Plus className="size-4" />
            <span className="hidden sm:inline">Add</span>
          </Button>
        </form>
      )}
      {tab !== "completed" && quickPreview && (
        <p className="text-muted-foreground -mt-2 px-1 text-xs" aria-live="polite">
          {quickPreview}
        </p>
      )}

      {resource.status === "failed" ? (
        <EmptyState
          icon={ListTodo}
          title="Couldn't load tasks"
          description={resource.loadError}
          variant="destructive"
          action={
            <Button variant="outline" onClick={() => void refresh()}>
              Retry
            </Button>
          }
        />
      ) : resource.status === "loading" ? (
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
            {list.map((task, index) => {
              const firstUndated =
                tab === "upcoming" && !task.dueAt && (index === 0 || !!list[index - 1].dueAt);
              const overdue =
                task.status !== "done" && task.dueAt && new Date(task.dueAt).getTime() < now;
              return (
                <Fragment key={task.id}>
                  {firstUndated && (
                    <li className="bg-muted/30 text-muted-foreground px-4 py-1.5 text-xs font-medium">
                      No date
                    </li>
                  )}
                  <li className="hover:bg-muted/40 flex items-start gap-3 px-4 py-3">
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
                          "text-[15px] leading-6 [overflow-wrap:anywhere]",
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
                </Fragment>
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
  const { update } = useTaskMutations();

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
    const input: TaskUpdateBody = {
      title: form.title.trim(),
      description: form.description.trim(),
      status: form.status,
      priority: form.priority,
      dueAt: form.due ? new Date(form.due).toISOString() : null,
    };
    try {
      await update.mutateAsync({ id: task.id, input });
      toast.success("Task saved");
      await onSaved();
    } catch (error) {
      toast.error(errorMessage(error, "Failed to save task"));
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
            <DialogDescription>Update the details, then save.</DialogDescription>
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
