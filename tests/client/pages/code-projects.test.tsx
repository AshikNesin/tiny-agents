import React from "react";
import { render as renderBare, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ConfirmProvider } from "@groot/ui/primitives";
import { MemoryRouter } from "react-router-dom";
import { CodeSettingsSection } from "@/pages/code/CodeSettings";
import { useCodeStore } from "@/store/code";
import type { HarnessInfo } from "@/lib/code/api";
import { usePeopleStore } from "@/store/people";
import { AppQueryProvider } from "../query-provider";

const render = (ui: Parameters<typeof renderBare>[0]) =>
  renderBare(ui, { wrapper: AppQueryProvider });

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
    useProjects: () => ({ projects: [], reload: () => {} }),
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
      <MemoryRouter>
        <CodeSettingsSection section="projects" />
      </MemoryRouter>
    </ConfirmProvider>,
  );
}

beforeEach(() => {
  usePeopleStore.setState({ role: "owner" });
  useCodeStore.setState({ harnesses: [shelley], statuses: {} });
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
    expect(await screen.findByRole("switch", { name: "Use the GitHub App" })).toBeChecked();
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
    expect(await screen.findByRole("switch", { name: "Use the GitHub App" })).toBeChecked();
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
    open();
    expect(await screen.findByRole("switch", { name: "Use the GitHub App" })).toBeChecked();
    expect(await screen.findByText(/Install the App on a repository first/)).toBeInTheDocument();
  });
});
