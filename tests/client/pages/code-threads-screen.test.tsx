import React from "react";
import { render as renderBare, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter } from "react-router-dom";
import { ThreadsScreen } from "@/pages/code/ThreadsScreen";
import type { ThreadSummary } from "@/lib/code/api";
import type { ProjectView } from "../../../apps/web/src/shared/api/code";
import { AppQueryProvider } from "../query-provider";

const render = (ui: Parameters<typeof renderBare>[0]) =>
  renderBare(ui, { wrapper: AppQueryProvider });

const listMock = vi.fn();
vi.mock("@/lib/code/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/code/api")>();
  return {
    ...original,
    codeApi: { ...original.codeApi, list: (...a: unknown[]) => listMock(...a) },
  };
});

const row = (id: string, extra: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id: `shelley:${id}`,
  instanceId: "shelley",
  kind: "shelley",
  nativeId: id,
  title: id,
  cwd: "/home/exedev/app",
  model: "predictable",
  parentId: null,
  createdAt: "2026-11-03T10:00:00Z",
  updatedAt: new Date().toISOString(),
  working: false,
  archived: false,
  cursor: 0,
  ...extra,
});

const project = { id: "p1", name: "feedbackbee" } as ProjectView;

describe("the Code Threads screen", () => {
  it("lists a project's threads by status, with their pull requests, and opens Archived on demand", async () => {
    listMock.mockResolvedValue([row("old-one", { projectId: "p1", archived: true })]);
    render(
      <MemoryRouter initialEntries={["/code/threads?project=p1"]}>
        <ThreadsScreen
          projects={[project]}
          threads={[
            row("Add iOS SDK", {
              projectId: "p1",
              pr: { number: 11, loop: "merged", url: "https://github.com/acme/web/pull/11" },
            }),
            row("Fix CI", {
              projectId: "p1",
              pr: { number: 12, loop: "needs_input", url: "https://github.com/acme/web/pull/12" },
            }),
            row("elsewhere"),
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "feedbackbee" })).toBeInTheDocument();
    const done = screen.getByRole("region", { name: "Done" });
    expect(within(done).getByRole("link", { name: /Add iOS SDK/ })).toHaveAttribute(
      "href",
      "/code/shelley%3AAdd%20iOS%20SDK",
    );
    expect(within(done).getByLabelText("Pull request #11, merged")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Needs you" })).getByRole("link", {
        name: /Fix CI/,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("elsewhere")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /Archived/ }));
    expect(listMock).toHaveBeenCalledWith("archived");
    expect(await screen.findByRole("link", { name: /old-one/ })).toBeInTheDocument();
  });
});
