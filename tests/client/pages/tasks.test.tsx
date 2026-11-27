import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, beforeEach, expect, it, vi } from "vite-plus/test";
import { MemoryRouter } from "react-router-dom";
import { GrootUIProvider } from "@groot/ui";
import { Tasks } from "@/pages/tasks/Tasks";
import type { Task, TaskCreateBody } from "../../../apps/web/src/shared/api/tasks";
import { fakeApi } from "../fakes/api";
import { AppQueryProvider } from "../query-provider";

const toastSuccess = vi.fn();
let api: ReturnType<typeof fakeApi>;

const tasksAre = (tasks: Task[]) => api.get("/tasks", () => tasks);
const created = () => api.sent<TaskCreateBody>("POST", "/tasks").map((request) => request.body);
const updates = () => api.sent("PATCH", "/tasks/t1").map((request) => request.body);

vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("sonner")>()),
  toast: Object.assign(vi.fn(), {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: vi.fn(),
  }),
}));

function endOfDay(offsetDays: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(23, 59, 59, 999);
  return d;
}

function task(overrides: Partial<Task>): Task {
  return {
    id: "t1",
    title: "Water the plants",
    description: "",
    status: "todo",
    priority: "medium",
    dueAt: endOfDay(0).toISOString(),
    completedAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function mount() {
  return render(
    <AppQueryProvider>
      <MemoryRouter>
        <GrootUIProvider>
          <Tasks />
        </GrootUIProvider>
      </MemoryRouter>
    </AppQueryProvider>,
  );
}

describe("Tasks page", () => {
  beforeEach(() => {
    api = fakeApi();
    api.post("/tasks", () => task({}));
    api.patch("/tasks/:id", () => task({}));
  });

  it("files a task added on Today as due today, so it stays on Today", async () => {
    tasksAre([]);
    const user = userEvent.setup();
    mount();

    await user.type(await screen.findByLabelText("New task title"), "Call mom{Enter}");

    await waitFor(() => expect(created()).toHaveLength(1));
    const { title, dueAt } = created()[0]!;
    expect(title).toBe("Call mom");
    expect(new Date(dueAt!).getTime()).toBe(endOfDay(0).getTime());
  });

  it("says where a task went when quick-add files it under another tab, and shows it there", async () => {
    const tomorrow = task({ id: "t2", title: "Call mom", dueAt: endOfDay(1).toISOString() });
    api.get("/tasks", () => (created().length === 0 ? [] : [tomorrow]));
    const user = userEvent.setup();
    mount();

    await user.type(await screen.findByLabelText("New task title"), "Call mom tomorrow{Enter}");

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    const [message, options] = toastSuccess.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(message).toBe("Added to Upcoming");
    expect(options.action.label).toBe("Show");
    expect(screen.queryByText("Call mom")).toBeNull();

    options.action.onClick();
    expect(await screen.findByText("Call mom")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Upcoming/ })).toHaveAttribute("aria-selected", "true");
  });

  it("reads a day and priority typed in quick-add (#97)", async () => {
    tasksAre([]);
    const user = userEvent.setup();
    mount();

    await user.type(await screen.findByLabelText("New task title"), "Call mom tomorrow 5pm !high");
    expect(screen.getByText(/"Call mom" · due .* · high priority/)).toBeTruthy();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(created()).toHaveLength(1));
    const input = created()[0]!;
    expect(input.title).toBe("Call mom");
    expect(input.priority).toBe("high");
    const due = new Date(input.dueAt!);
    expect(due.getHours()).toBe(17);
    expect(due.getDate()).toBe(endOfDay(1).getDate());
  });

  it("lists undated tasks last in Upcoming, under No date (#97)", async () => {
    tasksAre([
      task({ id: "t1", title: "Plan Goa trip", dueAt: null }),
      task({ id: "t2", title: "Send invoice", dueAt: endOfDay(3).toISOString() }),
    ]);
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("tab", { name: /Upcoming/ }));

    const items = (await screen.findAllByRole("listitem")).map((li) => li.textContent ?? "");
    const invoice = items.findIndex((text) => text.includes("Send invoice"));
    const header = items.findIndex((text) => text === "No date");
    const goa = items.findIndex((text) => text.includes("Plan Goa trip"));
    expect(invoice).toBeLessThan(header);
    expect(header).toBeLessThan(goa);
  });

  it("shows end-of-day due dates as a day, without a clock time", async () => {
    tasksAre([task({}), task({ id: "t2", title: "Pay rent", dueAt: endOfDay(1).toISOString() })]);
    const user = userEvent.setup();
    mount();

    expect(await screen.findByText("Today")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: /Upcoming/ }));
    expect(await screen.findByText("Tomorrow")).toBeTruthy();
    expect(screen.queryByText(/11:59/)).toBeNull();
  });

  it("offers an undo that restores the task after completing it", async () => {
    tasksAre([task({ status: "in_progress" })]);
    const user = userEvent.setup();
    mount();

    await user.click(await screen.findByRole("button", { name: 'Complete "Water the plants"' }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(updates()).toEqual([{ status: "done" }]);
    const [, options] = toastSuccess.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(options.action.label).toBe("Undo");
    options.action.onClick();
    await waitFor(() => expect(updates()).toEqual([{ status: "done" }, { status: "in_progress" }]));
  });
});
