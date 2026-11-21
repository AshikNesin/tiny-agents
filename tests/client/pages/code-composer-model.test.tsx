/**
 * @vitest-environment jsdom
 *
 * The new-thread composer's model and reasoning (issue #319): a model picked
 * on the Code page is still picked after going to another page and coming
 * back, in a project too, without starting a thread first. The network is
 * the boundary: fetch is stubbed.
 */
import { render as renderBare, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter } from "react-router-dom";
import { NO_CAPABILITIES } from "@tiny-agents/code/contracts";
import { NewConversation } from "@/pages/code/NewConversation";
import type { HarnessInfo } from "@/lib/code/api";
import type { ProjectView } from "../../../apps/web/src/shared/api/code";
import { AppQueryProvider } from "../query-provider";

const render = (ui: Parameters<typeof renderBare>[0]) =>
  renderBare(ui, { wrapper: AppQueryProvider });

const harness: HarnessInfo = {
  id: "claude-code-319",
  kind: "claude-code",
  label: "Claude Code",
  status: { state: "connected" },
  capabilities: NO_CAPABILITIES,
  commands: [],
};

const project: ProjectView = {
  id: "p1",
  name: "tiny-agents",
  repo: { owner: "AshikNesin", name: "tiny-agents" },
  transport: "gh",
  baseBranch: "main",
  checkoutPath: "/home/exedev/tiny-agents-code/AshikNesin--tiny-agents/checkout",
  defaultInstanceId: "claude-code-319",
  defaultModel: null,
  settings: {
    scripts: {},
    archiveOnMerge: true,
    draftPulls: true,
    branchPrefix: "ta/",
    protectedPaths: [],
    autofix: {
      triggers: { checks: true, reviews: true, conflicts: true, mergeQueue: true },
      finalCheck: false,
      autoMergeByDefault: false,
      trustedBots: [],
      hourlyLimit: 6,
      noOwnerLimit: 10,
      passMinutes: 20,
      onByDefault: false,
    },
  },
  createdAt: "2026-11-01T10:00:00Z",
};

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = new URL(String(url), "http://x").pathname;
      const data = path.endsWith("/models")
        ? [
            { id: "sonnet", label: "Sonnet", isDefault: true },
            { id: "opus", label: "Opus" },
          ]
        : [];
      return new Response(JSON.stringify({ success: true, data }), {
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

const open = () =>
  render(
    <MemoryRouter initialEntries={["/code/new?project=p1"]}>
      <NewConversation rows={[]} harnesses={[harness]} projects={[project]} />
    </MemoryRouter>,
  );

describe("the new-thread composer's model", () => {
  it("keeps the picked model after leaving the page and coming back", async () => {
    const user = userEvent.setup();
    const first = open();
    const picker = await screen.findByRole("button", { name: "Model" });
    await user.click(picker);
    await user.click(await screen.findByRole("option", { name: /Opus/ }));
    expect(screen.getByRole("button", { name: "Model" })).toHaveTextContent("Opus");

    first.unmount();
    open();
    expect(await screen.findByRole("button", { name: "Model" })).toHaveTextContent("Opus");
  });
});
