/**
 * @vitest-environment jsdom
 *
 * Sidebar Bots section: Pinned/Recent grouping, the fold, row state
 * indicators, and the pin action in the row menu.
 */
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter } from "react-router-dom";
import { BotRail, BotsSection } from "@/components/shell/BotsSection";
import { useBotsStore } from "@/store/bots";
import type { BotListEntry } from "../../../apps/web/src/shared/api/bots";

const pinMock = vi.fn();

vi.mock("@/lib/bots-api", () => ({
  botsApi: {
    pin: (...args: unknown[]) => pinMock(...args),
    get: vi.fn(),
  },
}));

function bot(id: string, overrides: Partial<BotListEntry> = {}): BotListEntry {
  return {
    id,
    conversationId: id,
    name: `Bot ${id}`,
    description: "",
    modelId: "m",
    lastMessagePreview: null,
    lastActivityAt: "2026-01-01T00:00:00.000Z",
    lastReadAt: null,
    unread: false,
    replying: false,
    approvals: 0,
    questions: 0,
    pinnedAt: null,
    ...overrides,
  };
}

function StoreBots({ activeId }: { activeId: string | null }) {
  const bots = useBotsStore((s) => s.bots);
  return <BotsSection bots={bots} activeId={activeId} />;
}

function renderSection(bots: BotListEntry[], activeId: string | null = null) {
  useBotsStore.setState({ bots });
  render(
    <MemoryRouter>
      <StoreBots activeId={activeId} />
    </MemoryRouter>,
  );
}

const user = userEvent.setup();

beforeEach(() => {
  pinMock.mockReset();
});

describe("BotsSection", () => {
  it("shows Pinned and Recent labels only when something is pinned", () => {
    renderSection([bot("a"), bot("b")]);
    expect(screen.queryByText("Pinned")).not.toBeInTheDocument();
    expect(screen.queryByText("Recent")).not.toBeInTheDocument();
  });

  it("groups pinned bots above recent ones", () => {
    renderSection([bot("a"), bot("p", { pinnedAt: "2026-01-02T00:00:00.000Z" })]);
    expect(screen.getByText("Pinned")).toBeInTheDocument();
    expect(screen.getByText("Recent")).toBeInTheDocument();
    const names = screen.getAllByRole("link").map((link) => link.textContent);
    expect(names).toEqual(["Bot p", "Bot a"]);
  });

  it("folds after 8 recent bots and expands on Show more", async () => {
    const bots = Array.from({ length: 11 }, (_, i) =>
      bot(`b${i}`, { lastActivityAt: `2026-01-${String(20 - i).padStart(2, "0")}T00:00:00.000Z` }),
    );
    renderSection(bots);
    expect(screen.getAllByRole("link")).toHaveLength(8);
    await user.click(screen.getByRole("button", { name: /show more \(3\)/i }));
    expect(screen.getAllByRole("link")).toHaveLength(11);
    await user.click(screen.getByRole("button", { name: /show less/i }));
    expect(screen.getAllByRole("link")).toHaveLength(8);
  });

  it("marks the open bot as the current page", () => {
    renderSection([bot("a"), bot("b")], "b");
    expect(screen.getByRole("link", { name: "Bot b" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Bot a" })).not.toHaveAttribute("aria-current");
  });

  it("shows approvals, questions, replying and unread states", () => {
    renderSection([
      bot("a", { approvals: 2 }),
      bot("b", { replying: true }),
      bot("c", { unread: true }),
      bot("d", { questions: 1, replying: true }),
      bot("e", { approvals: 1, questions: 2 }),
    ]);
    expect(screen.getByLabelText("2 awaiting approval")).toBeInTheDocument();
    expect(screen.getByLabelText("1 question for you")).toHaveTextContent("1");
    expect(screen.getByLabelText("1 awaiting approval, 2 questions for you")).toHaveTextContent(
      "3",
    );
    expect(screen.getByRole("status", { name: "Replying" })).toBeInTheDocument();
    expect(screen.getByLabelText("Unread")).toHaveClass("block", "size-2");
  });

  it("pins a bot from the row menu", async () => {
    pinMock.mockResolvedValue({ pinnedAt: "2026-01-05T00:00:00.000Z" });
    renderSection([bot("a")]);
    await user.click(screen.getByRole("button", { name: "Bot a actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Pin" }));
    await waitFor(() => expect(pinMock).toHaveBeenCalledWith("a", true));
    await waitFor(() =>
      expect(useBotsStore.getState().bots[0].pinnedAt).toBe("2026-01-05T00:00:00.000Z"),
    );
    expect(
      within(screen.getByRole("region", { name: "Bots" })).getByText("Pinned"),
    ).toBeInTheDocument();
  });

  it("rolls the pin back when the server refuses", async () => {
    pinMock.mockRejectedValue(new Error("nope"));
    renderSection([bot("a")]);
    await user.click(screen.getByRole("button", { name: "Bot a actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Pin" }));
    await waitFor(() => expect(pinMock).toHaveBeenCalled());
    await waitFor(() => expect(useBotsStore.getState().bots[0].pinnedAt).toBeNull());
  });
});

describe("BotRail", () => {
  it("keeps a bot that is waiting on you visible when the sidebar is folded", () => {
    render(
      <MemoryRouter>
        <BotRail
          bots={[bot("a"), bot("b", { approvals: 1 }), bot("c", { unread: true })]}
          activeId={null}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Bot b, 1 awaiting approval" })).toHaveTextContent("1");
    expect(screen.getByRole("link", { name: "Bot c, unread" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Bot a/ })).not.toBeInTheDocument();
  });
});
