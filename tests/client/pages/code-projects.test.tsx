/**
 * The Code page's Projects dialog, New project form (issue #297): with the
 * GitHub App on, the repository picker is the searchable SearchSelect the
 * composer's model picker uses, not a plain select; typing filters the App's
 * repositories and Enter picks one, and a repo can't be typed in by hand.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ConfirmProvider } from "@groot/ui/primitives";
import { ProjectsDialog } from "@/pages/code/ProjectsDialog";
import type { HarnessInfo } from "@/lib/code/api";

const toastError = vi.fn();
const appRepositories = vi.fn();
const create = vi.fn();

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: (...args: unknown[]) => toastError(...args) },
}));

vi.mock("@/lib/code/projects", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/code/projects")>();
  return {
    ...original,
    projectsApi: {
      ...original.projectsApi,
      github: () =>
        Promise.resolve({
          credential: "gh",
          tokenHandle: null,
          app: { slug: "tiny-agents", name: "tiny-agents", webhooks: false },
          sandbox: true,
          tools: { git: true, gh: true },
          login: "ashiknesin",
          error: null,
        }),
      appRepositories: (...args: unknown[]) => appRepositories(...args),
      create: (...args: unknown[]) => create(...args),
    },
  };
});

const shelley: HarnessInfo = {
  id: "shelley",
  kind: "shelley",
  label: "Shelley",
  status: { state: "connected" },
} as unknown as HarnessInfo;

function open() {
  render(
    <ConfirmProvider>
      <ProjectsDialog
        open
        onOpenChange={() => {}}
        harnesses={[shelley]}
        projects={[]}
        onChange={() => {}}
      />
    </ConfirmProvider>,
  );
}

beforeEach(() => {
  appRepositories.mockResolvedValue([
    { fullName: "AshikNesin/30DaysOfWebDev", installationId: 1, private: false },
    { fullName: "AshikNesin/tiny-agents", installationId: 1, private: false },
    { fullName: "AshikNesin/404less", installationId: 1, private: false },
  ]);
  create.mockResolvedValue({});
});

describe("New project with the GitHub App", () => {
  it("searches the App's repositories and picks one", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    open();
    await user.click(screen.getByRole("switch", { name: "Use the GitHub App" }));
    const trigger = await screen.findByRole("button", { name: "Repository" });
    await user.click(trigger);
    const search = await screen.findByPlaceholderText("Search repositories…");
    await user.type(search, "tiny");
    expect(screen.getByText("AshikNesin/tiny-agents")).toBeInTheDocument();
    expect(screen.queryByText("AshikNesin/404less")).not.toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(trigger).toHaveTextContent("AshikNesin/tiny-agents");
    await user.click(screen.getByTestId("code-project-create"));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "AshikNesin/tiny-agents", transport: "app" }),
    );
  });

  it("shows a search row only for installed repositories, never free text", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    open();
    await user.click(screen.getByRole("switch", { name: "Use the GitHub App" }));
    const trigger = await screen.findByRole("button", { name: "Repository" });
    await user.click(trigger);
    const search = await screen.findByPlaceholderText("Search repositories…");
    await user.type(search, "some-org/not-installed");
    expect(screen.getByText(/No repository matches/)).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveTextContent("Pick a repository the App is installed on");
    expect(screen.getByTestId("code-project-create")).toBeDisabled();
    expect(screen.queryByPlaceholderText("owner/repository or its GitHub URL")).toBeNull();
  });

  it("says so when the App is installed on nothing yet", async () => {
    appRepositories.mockResolvedValue([]);
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    open();
    await user.click(screen.getByRole("switch", { name: "Use the GitHub App" }));
    expect(await screen.findByText(/Install the App on a repository first/)).toBeInTheDocument();
  });
});
