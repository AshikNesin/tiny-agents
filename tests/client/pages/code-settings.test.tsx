import React from "react";
import { render as renderBare, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ConfirmProvider } from "@groot/ui/primitives";
import { NO_CAPABILITIES } from "@tiny-agents/code/contracts";
import { CodeWorkspace } from "@/pages/code/Workspace";
import { useCodeStore } from "@/store/code";
import { usePeopleStore } from "@/store/people";
import type { HarnessInfo } from "@/lib/code/api";
import type { GitHubStatus, ProjectView } from "../../../apps/web/src/shared/api/code";
import { AppQueryProvider } from "../query-provider";

const render = (ui: Parameters<typeof renderBare>[0]) =>
  renderBare(ui, { wrapper: AppQueryProvider });

const patches: Array<[string, unknown]> = [];
const puts: Array<[string, unknown]> = [];

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }),
}));

vi.mock("@groot/shell/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@groot/shell/lib/api")>();
  const reads: Record<string, () => unknown> = {
    "/code/projects": () => [project],
    "/code/github": () => github,
    "/code/github/app/repositories": () => [],
    "/code/reviews/settings": () => inbox,
  };
  return {
    ...original,
    apiClient: Object.assign(Object.create(original.apiClient) as typeof original.apiClient, {
      get: async (path: string) => reads[path]?.() ?? [],
      post: async () => ({}),
      put: async (path: string, body: unknown) => {
        puts.push([path, body]);
        return path === "/code/reviews/settings" ? { ...inbox, ...(body as object) } : github;
      },
      delete: async () => ({}),
      patch: async (path: string, body: unknown) => {
        patches.push([path, body]);
        return project;
      },
    }),
  };
});

const project: ProjectView = {
  id: "p1",
  name: "tiny-agents",
  repo: { owner: "AshikNesin", name: "tiny-agents" },
  transport: "app",
  baseBranch: "main",
  checkoutPath: "/home/exedev/tiny-agents-code/AshikNesin--tiny-agents/checkout",
  defaultInstanceId: null,
  defaultModel: null,
  settings: {
    scripts: {},
    archiveOnMerge: true,
    draftPulls: true,
    branchPrefix: "ta/",
    protectedPaths: [".github/workflows/**"],
    workflowInstructions: "",
    autofix: {
      triggers: { checks: true, reviews: true, conflicts: true },
      trustedBots: ["coderabbitai[bot]"],
      hourlyLimit: 6,
      noOwnerLimit: 10,
      passMinutes: 20,
      onByDefault: false,
    },
  },
  createdAt: "2026-11-01T10:00:00Z",
};

const inbox = {
  repos: "all",
  direct: true,
  drafts: false,
  bots: false,
  mute: [] as string[],
  limit: 10,
};

const github: GitHubStatus = {
  credential: "gh",
  tokenHandle: null,
  app: { slug: "nesinio-tiny-agents", name: "nesinio-tiny-agents", webhooks: true },
  sandbox: true,
  tools: { git: true, gh: true },
  login: "AshikNesin",
  error: null,
};

const shelley: HarnessInfo = {
  id: "shelley",
  kind: "shelley",
  label: "Shelley",
  status: { state: "connected" },
  capabilities: NO_CAPABILITIES,
  commands: [],
  ssh: { host: null, user: null, port: null, keyFile: null },
};

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{pathname + search}</output>;
}

function renderAt(path: string) {
  return render(
    <ConfirmProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          {[
            "/code",
            "/code/new",
            "/code/settings",
            "/code/settings/:section",
            "/code/settings/projects/:projectId",
            "/code/:conversationId",
          ].map((p) => (
            <Route key={p} path={p} element={<CodeWorkspace />} />
          ))}
        </Routes>
        <Where />
      </MemoryRouter>
    </ConfirmProvider>,
  );
}

beforeEach(() => {
  usePeopleStore.setState({ role: "owner" });
  patches.length = 0;
  puts.length = 0;
  useCodeStore.setState({ harnesses: [shelley], statuses: {}, threads: [] });
});

describe("Code settings", () => {
  it("lists the projects as pages, not a dialog", async () => {
    renderAt("/code/settings/projects");
    const main = await screen.findByRole("main");
    const link = await within(main).findByRole("link", { name: /tiny-agents/ });
    expect(link).toHaveAttribute("href", "/code/settings/projects/p1");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("starts Add a project with the repository the Reviews screen asked for (#386)", async () => {
    renderAt("/code/settings/projects?repo=other%2Flib");
    const add = await screen.findByRole("button", { name: "Add" });
    await waitFor(() => expect(add).toBeEnabled());
    expect(await screen.findByText("other/lib")).toBeInTheDocument();
  });

  it("saves each project setting on its own page", async () => {
    renderAt("/code/settings/projects/p1");
    const branch = await screen.findByRole("textbox", { name: "Base branch" });
    expect(branch).toHaveValue("main");
    await userEvent.clear(branch);
    await userEvent.type(branch, "develop");
    await userEvent.tab();
    await waitFor(() =>
      expect(patches).toContainEqual(["/code/projects/p1", { baseBranch: "develop" }]),
    );

    const prefix = screen.getByRole("textbox", { name: "Branch prefix" });
    expect(prefix).toHaveValue("ta/");
    await userEvent.clear(prefix);
    await userEvent.type(prefix, "ashik/");
    await userEvent.tab();
    await waitFor(() =>
      expect(patches.at(-1)).toEqual([
        "/code/projects/p1",
        { settings: { branchPrefix: "ashik/" } },
      ]),
    );

    await userEvent.type(screen.getByRole("textbox", { name: "Setup script" }), "pnpm install");
    await userEvent.tab();
    await waitFor(() =>
      expect(patches.at(-1)).toEqual([
        "/code/projects/p1",
        { settings: { scripts: { setup: "pnpm install" } } },
      ]),
    );
    await userEvent.click(screen.getByRole("switch", { name: "Resolve conflicts" }));
    await waitFor(() =>
      expect(patches.at(-1)).toEqual([
        "/code/projects/p1",
        { settings: { autofix: { triggers: { conflicts: false } } } },
      ]),
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "Instructions for every workflow" }),
      "Run the tests first",
    );
    await userEvent.tab();
    await waitFor(() =>
      expect(patches.at(-1)).toEqual([
        "/code/projects/p1",
        { settings: { workflowInstructions: "Run the tests first" } },
      ]),
    );
    const drafts = screen.getByRole("switch", { name: "Open new PRs as drafts" });
    expect(drafts).toBeChecked();
    await userEvent.click(drafts);
    await waitFor(() =>
      expect(patches.at(-1)).toEqual(["/code/projects/p1", { settings: { draftPulls: false } }]),
    );
  });

  it("returns from GitHub's App setup to the GitHub settings page", async () => {
    renderAt("/code?github=installed");
    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent("/code/settings/github"),
    );
    expect(await screen.findByText("nesinio-tiny-agents")).toBeInTheDocument();
  });

  it("starts a project's new thread with that project picked", async () => {
    renderAt("/code/new?project=p1");
    const picker = await screen.findByRole("button", { name: "Project" });
    await waitFor(() => expect(picker).toHaveTextContent("tiny-agents"));
    expect(screen.queryByRole("button", { name: "Working directory" })).toBeNull();
  });
});

describe("Review list settings", () => {
  it("saves what the sidebar's Reviews list leaves out", async () => {
    renderAt("/code/settings/reviews");

    const direct = await screen.findByRole("switch", { name: "Only requests to you" });
    expect(direct).toBeChecked();
    await userEvent.click(direct);
    await waitFor(() => expect(puts.at(-1)).toEqual(["/code/reviews/settings", { direct: false }]));

    await userEvent.click(screen.getByRole("switch", { name: "Only project repositories" }));
    await waitFor(() =>
      expect(puts.at(-1)).toEqual(["/code/reviews/settings", { repos: "projects" }]),
    );

    await userEvent.type(
      screen.getByRole("textbox", { name: "Hide PRs matching" }),
      "back-merge, @release-bot{Enter}",
    );
    await waitFor(() =>
      expect(puts.at(-1)).toEqual([
        "/code/reviews/settings",
        { mute: ["back-merge", "@release-bot"] },
      ]),
    );
  });
});
