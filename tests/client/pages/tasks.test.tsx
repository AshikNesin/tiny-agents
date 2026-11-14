/**
 * Tasks page: quick-add files a task under the tab it was typed in, due
 * dates read as days ("Today", "Tomorrow") rather than end-of-day clock
 * times, and completing a task offers an undo.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, beforeEach, expect, it, vi } from "vite-plus/test";
import { MemoryRouter } from "react-router-dom";
import { GrootUIProvider } from "@groot/ui";
import { Tasks } from "@/pages/tasks/Tasks";
import type { Task } from "../../../apps/web/src/shared/api/tasks";
import { AppQueryProvider } from "../query-provider";

const listMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();
const toastSuccess = vi.fn();

vi.mock("@/lib/tasks-api", () => ({
  tasksApi: {
    list: (...args: unknown[]) => listMock(...args),
    create: (...args: unknown[]) => createMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
    remove: vi.fn(),
  },
}));

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
    vi.clearAllMocks();
    createMock.mockResolvedValue(task({}));
    updateMock.mockResolvedValue(task({}));
  });

  it("files a task added on Today as due today, so it stays on Today", async () => {
    listMock.mockResolvedValue([]);
    const user = userEvent.setup();
    mount();

    await user.type(await screen.findByLabelText("New task title"), "Call mom{Enter}");

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    const { title, dueAt } = createMock.mock.calls[0][0] as { title: string; dueAt: string };
    expect(title).toBe("Call mom");
    expect(new Date(dueAt).getTime()).toBe(endOfDay(0).getTime());
  });

  it("reads a day and priority typed in quick-add (#97)", async () => {
    listMock.mockResolvedValue([]);
    const user = userEvent.setup();
    mount();

    await user.type(await screen.findByLabelText("New task title"), "Call mom tomorrow 5pm !high");
    expect(screen.getByText(/"Call mom" · due .* · high priority/)).toBeTruthy();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    const input = createMock.mock.calls[0][0] as { title: string; dueAt: string; priority: string };
    expect(input.title).toBe("Call mom");
    expect(input.priority).toBe("high");
    const due = new Date(input.dueAt);
    expect(due.getHours()).toBe(17);
    expect(due.getDate()).toBe(endOfDay(1).getDate());
  });

  it("lists undated tasks last in Upcoming, under No date (#97)", async () => {
    listMock.mockResolvedValue([
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
    listMock.mockResolvedValue([
      task({}),
      task({ id: "t2", title: "Pay rent", dueAt: endOfDay(1).toISOString() }),
    ]);
    const user = userEvent.setup();
    mount();

    expect(await screen.findByText("Today")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: /Upcoming/ }));
    expect(await screen.findByText("Tomorrow")).toBeTruthy();
    expect(screen.queryByText(/11:59/)).toBeNull();
  });

  it("offers an undo that restores the task after completing it", async () => {
    listMock.mockResolvedValue([task({ status: "in_progress" })]);
    const user = userEvent.setup();
    mount();

    await user.click(await screen.findByRole("button", { name: 'Complete "Water the plants"' }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(updateMock).toHaveBeenCalledWith("t1", { status: "done" });
    const [, options] = toastSuccess.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(options.action.label).toBe("Undo");
    options.action.onClick();
    await waitFor(() =>
      expect(updateMock).toHaveBeenLastCalledWith("t1", { status: "in_progress" }),
    );
  });
});
