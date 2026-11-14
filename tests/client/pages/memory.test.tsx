/**
 * Memory page behavior (issue #22 phase C): per-bot sections group rows
 * under category headers with counts, search filters by text across bots,
 * the add dialog posts to the right bot, and superseded rows render
 * struck through with their source line.
 */
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, beforeEach, expect, it, vi } from "vite-plus/test";
import { MemoryRouter } from "react-router-dom";
import { MemoryPage } from "@/pages/memory/Memory";
import { GrootUIProvider } from "@groot/ui";
import type { MemoryRecord } from "../../../apps/web/src/shared/api/memories";

const listMock = vi.fn();
const getMock = vi.fn();
const listMemoriesMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();
const updateMemoryMock = vi.fn();
const deleteMemoryMock = vi.fn();

vi.mock("@/lib/bots-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/bots-api")>();
  return {
    ...original,
    botsApi: {
      list: (...args: unknown[]) => listMock(...args),
      get: (...args: unknown[]) => getMock(...args),
      listMemories: (...args: unknown[]) => listMemoriesMock(...args),
      createMemory: (...args: unknown[]) => createMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
      updateMemory: (...args: unknown[]) => updateMemoryMock(...args),
      deleteMemory: (...args: unknown[]) => deleteMemoryMock(...args),
    },
  };
});

function memory(partial: Partial<MemoryRecord> & { id: string; botId: string }): MemoryRecord {
  return {
    text: "Prefers TypeScript over JavaScript",
    category: "preference",
    status: "active",
    source: "capture",
    confidence: 0.9,
    until: null,
    supersededById: null,
    supersededAt: null,
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString(),
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}

const bots = [
  { id: "b1", name: "Helper Bot" },
  { id: "b2", name: "Journal Bot" },
];

function loadPage(rows: Record<string, MemoryRecord[]> = {}) {
  listMock.mockResolvedValue(bots);
  getMock.mockImplementation(async (id: string) => ({ id, memoryEnabled: true }));
  listMemoriesMock.mockImplementation(async (id: string) => ({
    memories: rows[id] ?? [],
  }));
  createMock.mockResolvedValue({ memory: memory({ id: "new", botId: "b1" }) });
  updateMock.mockResolvedValue({ id: "b1" });
  updateMemoryMock.mockResolvedValue({ memory: memory({ id: "m1", botId: "b1" }) });
  deleteMemoryMock.mockResolvedValue({ deleted: true });
}

function mount() {
  return render(
    <React.StrictMode>
      <MemoryRouter>
        <GrootUIProvider>
          <MemoryPage />
        </GrootUIProvider>
      </MemoryRouter>
    </React.StrictMode>,
  );
}

describe("Memory page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("groups a bot's memories under category headers with counts", async () => {
    loadPage({
      b1: [
        memory({ id: "m1", botId: "b1" }),
        memory({ id: "m2", botId: "b1", text: "Wants to run daily", category: "goal" }),
        memory({
          id: "m3",
          botId: "b1",
          text: "Old preference",
          status: "superseded",
          supersededById: "m1",
          supersededAt: new Date().toISOString(),
        }),
      ],
    });
    mount();

    const section = await screen.findByLabelText("Helper Bot memories");
    expect(within(section).getByText("Preferences")).toBeTruthy();
    expect(within(section).getByText("Goals")).toBeTruthy();
    expect(within(section).queryByText("Habits")).toBeNull();
    // 2 memories counts only active rows (superseded is not active).
    expect(within(section).getByText("2 memories")).toBeTruthy();
    // Source lines: all three rows are capture-sourced (superseded keeps its provenance).
    expect(within(section).getAllByText(/From chat · /).length).toBe(3);
    expect(within(section).getByText("superseded")).toBeTruthy();
  });

  it("lists bots with memories first and folds the rest into one compact list", async () => {
    loadPage({ b2: [memory({ id: "m9", botId: "b2", text: "Journals at night" })] });
    mount();
    const journal = await screen.findByLabelText("Journal Bot memories");
    const empty = screen.getByLabelText("Bots without memories");
    // Journal Bot (with a memory) comes before the empty list holding Helper Bot.
    expect(journal.compareDocumentPosition(empty) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(empty).getByText("Helper Bot")).toBeInTheDocument();
    expect(screen.queryByLabelText("Helper Bot memories")).toBeNull();
    expect(screen.queryByText(/Nothing yet\. Chat with/)).toBeNull();
    expect(within(empty).getByText("Learns from chats")).toBeInTheDocument();
  });

  it("renders manual rows with their source line", async () => {
    loadPage({
      b1: [memory({ id: "m1", botId: "b1", source: "manual", confidence: null })],
    });
    mount();

    expect(await screen.findByText("Added manually")).toBeTruthy();
  });

  it("searches across bots by text", async () => {
    loadPage({
      b1: [memory({ id: "m1", botId: "b1", text: "Prefers TypeScript" })],
      b2: [memory({ id: "m2", botId: "b2", text: "Lives in Chennai", category: "fact" })],
    });
    mount();
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    expect(await screen.findByLabelText("Helper Bot memories")).toBeTruthy();
    expect(screen.getByLabelText("Journal Bot memories")).toBeTruthy();

    await user.type(screen.getByLabelText("Search memories"), "chennai");
    expect(screen.queryByLabelText("Helper Bot memories")).toBeNull();
    const journal = screen.getByLabelText("Journal Bot memories");
    expect(within(journal).getByText("Lives in Chennai")).toBeTruthy();
  });

  it("adds a memory through the dialog", async () => {
    loadPage();
    mount();
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    // A bot with no memories yet sits in the compact list at the end (#95).
    const empty = await screen.findByLabelText("Bots without memories");
    await user.click(within(empty).getByRole("button", { name: "Add memory for Helper Bot" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByLabelText(/forgets? after/i)).toBeNull();
    expect(within(dialog).queryByText(/leave empty to keep forever/i)).toBeNull();
    await user.type(within(dialog).getByLabelText("Memory"), "Prefers dark mode");
    await user.click(within(dialog).getByRole("combobox", { name: "Category" }));
    await user.click(await screen.findByRole("option", { name: "Habits" }));

    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith("b1", {
      text: "Prefers dark mode",
      category: "habit",
    });
  });

  it("edits a memory without changing its automatically captured expiry", async () => {
    loadPage({
      b1: [memory({ id: "m1", botId: "b1", until: "2099-11-01T00:00:00.000Z" })],
    });
    mount();
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    await user.click(
      await screen.findByRole("button", {
        name: /Edit memory "Prefers TypeScript over JavaScript"/,
      }),
    );

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByLabelText(/forgets? after/i)).toBeNull();
    const field = within(dialog).getByLabelText("Memory");
    await user.clear(field);
    await user.type(field, "Prefers TypeScript strictly");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateMemoryMock).toHaveBeenCalledTimes(1));
    expect(updateMemoryMock).toHaveBeenCalledWith("m1", {
      text: "Prefers TypeScript strictly",
      category: "preference",
    });
  });

  it("clears a past expiry when restoring an expired memory", async () => {
    loadPage({
      b1: [memory({ id: "m1", botId: "b1", status: "expired", until: "2020-01-01T00:00:00.000Z" })],
    });
    mount();
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    await user.click(await screen.findByRole("button", { name: /Edit memory/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("checkbox", { name: "Restore to active" })).toBeChecked();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateMemoryMock).toHaveBeenCalledWith("m1", {
        text: "Prefers TypeScript over JavaScript",
        category: "preference",
        restore: true,
        until: null,
      }),
    );
  });

  it("preserves expiry when editing an expired memory without restoring it", async () => {
    loadPage({
      b1: [memory({ id: "m1", botId: "b1", status: "expired", until: "2020-01-01T00:00:00.000Z" })],
    });
    mount();
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    await user.click(await screen.findByRole("button", { name: /Edit memory/ }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("checkbox", { name: "Restore to active" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateMemoryMock).toHaveBeenCalledWith("m1", {
        text: "Prefers TypeScript over JavaScript",
        category: "preference",
      }),
    );
  });

  it("confirms before deleting and never re-adds", async () => {
    loadPage({ b1: [memory({ id: "m1", botId: "b1" })] });
    mount();
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    await user.click(
      await screen.findByRole("button", {
        name: /Delete memory "Prefers TypeScript over JavaScript"/,
      }),
    );
    expect(await screen.findByText("Delete this memory?")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteMemoryMock).toHaveBeenCalledWith("m1"));
  });

  it("toggles a bot's memory off through the bots PATCH", async () => {
    loadPage({ b1: [memory({ id: "m1", botId: "b1" })] });
    mount();
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    const toggle = await screen.findByRole("switch", { name: /turn off memory for helper bot/i });
    await user.click(toggle);

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith("b1", { memoryEnabled: false }));
    // The off note renders under the header.
    expect(await screen.findByText(/no longer learns from chats/i)).toBeTruthy();
  });

  it("collapses archived memories behind an expandable group", async () => {
    loadPage({
      b1: [
        memory({ id: "m1", botId: "b1" }),
        memory({ id: "m2", botId: "b1", text: "Old fact", status: "archived" }),
      ],
    });
    mount();
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    const section = await screen.findByLabelText("Helper Bot memories");
    expect(within(section).queryByText("Old fact")).toBeNull();

    await user.click(within(section).getByRole("button", { name: /Archived/i }));
    expect(await within(section).findByText("Old fact")).toBeTruthy();
  });

  it("mutes expired memories without deleting the row", async () => {
    loadPage({
      b1: [
        memory({
          id: "m1",
          botId: "b1",
          text: "Visiting Berlin",
          status: "expired",
          until: new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
        }),
      ],
    });
    mount();

    const section = await screen.findByLabelText("Helper Bot memories");
    expect(within(section).getByText("Visiting Berlin")).toBeTruthy();
    expect(within(section).getByText("expired")).toBeTruthy();
  });
});
