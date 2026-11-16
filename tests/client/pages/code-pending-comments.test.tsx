/**
 * Line comments wait in the thread, above the composer, until they reach the
 * agent: the thread lists them (each removable), and Send now posts them as
 * one message, after which the thread has none waiting.
 */
import React from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { PendingComments } from "@/pages/code/PendingComments";
import { useCommentStore } from "@/lib/code/comments";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

const calls: Array<{ method: string; path: string }> = [];
const thread = "/code/threads/shelley%3Ac1";
const drafts = [
  {
    id: "d1",
    path: "src/a.ts",
    side: "new",
    startLine: 2,
    endLine: 4,
    quote: "",
    body: "Rename this",
    createdAt: "2026-11-01T10:00:00Z",
  },
  {
    id: "d2",
    path: "README.md",
    side: "new",
    startLine: 1,
    endLine: 1,
    quote: "",
    body: "Typo",
    createdAt: "2026-11-01T10:01:00Z",
  },
];

vi.mock("@groot/shell/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@groot/shell/lib/api")>();
  const answer = (method: string) => async (path: string) => {
    calls.push({ method, path });
    if (method === "GET" && path === `${thread}/review/drafts`) return drafts;
    if (method === "POST" && path === `${thread}/review/send`) return { sent: 2 };
    if (method === "DELETE") return { deleted: true };
    throw new Error(`unexpected ${method} ${path}`);
  };
  return {
    ...original,
    apiClient: Object.assign(Object.create(original.apiClient) as typeof original.apiClient, {
      get: answer("GET"),
      post: answer("POST"),
      delete: answer("DELETE"),
    }),
  };
});

afterEach(() => {
  calls.length = 0;
  useCommentStore.setState({ byThread: {} });
});

describe("comments waiting in the thread", () => {
  it("lists them above the composer and sends them now on request", async () => {
    const user = userEvent.setup();
    render(<PendingComments threadId="shelley:c1" />);
    const tray = await screen.findByRole("region", { name: "Comments for the agent" });
    expect(tray).toHaveTextContent("2 comments go with your next message");

    await user.click(within(tray).getByRole("button", { name: "Show comments" }));
    expect(within(tray).getByText("src/a.ts:2-4")).toBeInTheDocument();
    expect(within(tray).getByText("Rename this")).toBeInTheDocument();

    await user.click(within(tray).getByRole("button", { name: "Send now" }));
    expect(calls).toContainEqual({ method: "POST", path: `${thread}/review/send` });
    expect(screen.queryByRole("region", { name: "Comments for the agent" })).toBeNull();
  });

  it("removes one comment and keeps the rest", async () => {
    const user = userEvent.setup();
    render(<PendingComments threadId="shelley:c1" />);
    const tray = await screen.findByRole("region", { name: "Comments for the agent" });
    await user.click(within(tray).getByRole("button", { name: "Show comments" }));
    await user.click(within(tray).getAllByRole("button", { name: "Remove comment" })[1]!);
    await act(async () => {});
    expect(calls).toContainEqual({ method: "DELETE", path: `${thread}/review/drafts/d2` });
    expect(tray).toHaveTextContent("1 comment goes with your next message");
  });

  it("shows nothing for a guest, who has no saved comments", () => {
    render(<PendingComments threadId="shelley:c1" enabled={false} />);
    expect(screen.queryByRole("region")).toBeNull();
    expect(calls).toEqual([]);
  });
});
