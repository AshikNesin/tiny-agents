import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, beforeEach, expect, it } from "vite-plus/test";
import { MemoryRouter } from "react-router-dom";
import { MemoryPage } from "@/pages/memory/Memory";
import { GrootUIProvider } from "@groot/ui";
import type { Bot, BotListEntry } from "../../../apps/web/src/shared/api/bots";
import type { Deleted } from "../../../apps/web/src/shared/api/common";
import type {
  MemoryList,
  MemoryRecord,
  MemoryResult,
} from "../../../apps/web/src/shared/api/memories";
import { FIXED_NOW } from "../../test-clock";
import { fakeApi } from "../fakes/api";
import { AppQueryProvider } from "../query-provider";

let api: ReturnType<typeof fakeApi>;

function memory(partial: Partial<MemoryRecord> & { id: string; botId: string }): MemoryRecord {
  return {
    text: "Prefers TypeScript over JavaScript",
    category: "preference",
    status: "active",
    source: "capture",
    until: null,
    supersededById: null,
    supersededAt: null,
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString(),
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}

const NAMES: Record<string, string> = { b1: "Helper Bot", b2: "Journal Bot" };

function bot(id: string): Bot {
  return {
    id,
    name: NAMES[id] ?? id,
    description: "",
    systemPrompt: "",
    modelId: null,
    conversationId: `c-${id}`,
    chatStartedAt: FIXED_NOW,
    lastReadAt: null,
    lastActivityAt: FIXED_NOW,
    lastMessagePreview: null,
    memoryEnabled: true,
    autoReview: false,
    yoloByDefault: false,
    memoryCapturedThrough: null,
    pinnedAt: null,
    browserProfile: "shared",
    projectId: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    toolPermissions: {},
    skillIds: [],
    connectionIds: [],
    connectionCapabilities: [],
    guestIds: [],
  };
}

function listed(id: string): BotListEntry {
  return {
    id,
    conversationId: `c-${id}`,
    name: NAMES[id] ?? id,
    description: "",
    modelId: null,
    lastMessagePreview: null,
    lastActivityAt: FIXED_NOW,
    lastReadAt: null,
    unread: false,
    replying: false,
    approvals: 0,
    questions: 0,
    pinnedAt: null,
    projectId: null,
  };
}

function loadPage(rows: Record<string, MemoryRecord[]> = {}) {
  api.get("/bots", () => [listed("b1"), listed("b2")]);
  api.get("/bots/:id", ({ params }) => bot(params.id!));
  api.get("/bots/:id/memories", ({ params }): MemoryList => ({ memories: rows[params.id!] ?? [] }));
  api.post("/bots/:id/memories", (): MemoryResult => ({
    memory: memory({ id: "new", botId: "b1" }),
  }));
  api.patch("/bots/:id", () => ({ ...bot("b1"), memoryEnabled: false }));
  api.patch("/memories/:id", (): MemoryResult => ({ memory: memory({ id: "m1", botId: "b1" }) }));
  api.delete("/memories/:id", (): Deleted => ({ deleted: true }));
}

const edits = () => api.sent("PATCH", "/memories/m1").map((request) => request.body);

function mount() {
  return render(
    <React.StrictMode>
      <AppQueryProvider>
        <MemoryRouter>
          <GrootUIProvider>
            <MemoryPage />
          </GrootUIProvider>
        </MemoryRouter>
      </AppQueryProvider>
    </React.StrictMode>,
  );
}

describe("Memory page", () => {
  beforeEach(() => {
    api = fakeApi();
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
    expect(within(section).getByText("2 memories")).toBeTruthy();
    expect(within(section).getAllByText(/From chat · /).length).toBe(3);
    expect(within(section).getByText("superseded")).toBeTruthy();
  });

  it("lists bots with memories first and folds the rest into one compact list", async () => {
    loadPage({ b2: [memory({ id: "m9", botId: "b2", text: "Journals at night" })] });
    mount();
    const journal = await screen.findByLabelText("Journal Bot memories");
    const empty = screen.getByLabelText("Bots without memories");
    expect(journal.compareDocumentPosition(empty) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(empty).getByText("Helper Bot")).toBeInTheDocument();
    expect(screen.queryByLabelText("Helper Bot memories")).toBeNull();
    expect(screen.queryByText(/Nothing yet\. Chat with/)).toBeNull();
    expect(within(empty).getByText("Learns from chats")).toBeInTheDocument();
  });

  it("renders manual rows with their source line", async () => {
    loadPage({
      b1: [memory({ id: "m1", botId: "b1", source: "manual" })],
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

    const empty = await screen.findByLabelText("Bots without memories");
    await user.click(within(empty).getByRole("button", { name: "Add memory for Helper Bot" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByLabelText(/forgets? after/i)).toBeNull();
    expect(within(dialog).queryByText(/leave empty to keep forever/i)).toBeNull();
    await user.type(within(dialog).getByLabelText("Memory"), "Prefers dark mode");
    await user.click(within(dialog).getByRole("combobox", { name: "Category" }));
    await user.click(await screen.findByRole("option", { name: "Habits" }));

    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(api.sent("POST", "/bots/b1/memories")).toHaveLength(1));
    expect(api.sent("POST", "/bots/b1/memories")[0]!.body).toEqual({
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

    await waitFor(() => expect(edits()).toHaveLength(1));
    expect(edits()).toEqual([{ text: "Prefers TypeScript strictly", category: "preference" }]);
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
      expect(edits()).toEqual([
        {
          text: "Prefers TypeScript over JavaScript",
          category: "preference",
          restore: true,
          until: null,
        },
      ]),
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
      expect(edits()).toEqual([
        { text: "Prefers TypeScript over JavaScript", category: "preference" },
      ]),
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

    await waitFor(() => expect(api.sent("DELETE", "/memories/m1")).toHaveLength(1));
  });

  it("toggles a bot's memory off through the bots PATCH", async () => {
    loadPage({ b1: [memory({ id: "m1", botId: "b1" })] });
    mount();
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    const toggle = await screen.findByRole("switch", { name: /turn off memory for helper bot/i });
    await user.click(toggle);

    await waitFor(() =>
      expect(api.sent("PATCH", "/bots/b1").map((request) => request.body)).toEqual([
        { memoryEnabled: false },
      ]),
    );
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
