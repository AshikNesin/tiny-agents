/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { NewThread } from "@/pages/code/NewThread";
import { codeApi, type HarnessInfo } from "@/lib/code/api";
import type { ProjectView } from "../../../apps/web/src/shared/api/code";
import { NO_CAPABILITIES } from "../../../packages/code/src/contracts/capabilities";
import { AppQueryProvider } from "../query-provider";

vi.mock("@groot/shell/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@groot/shell/lib/api")>();
  return {
    ...original,
    apiClient: Object.assign(Object.create(original.apiClient) as typeof original.apiClient, {
      get: async () => [{ id: "pi-opus", label: "Opus", ready: true }],
    }),
  };
});

const harness = (id: string, label: string, modelSwitch: boolean) =>
  ({
    id,
    kind: id,
    label,
    status: { state: "ready" },
    capabilities: {
      ...NO_CAPABILITIES,
      settings: { ...NO_CAPABILITIES.settings, modelSwitch },
    },
    commands: [],
    ssh: null,
  }) as unknown as HarnessInfo;

const project = {
  id: "p1",
  name: "web",
  repo: { owner: "acme", name: "web" },
  defaultInstanceId: "pi",
  defaultModel: "pi-opus",
} as unknown as ProjectView;

afterEach(() => vi.restoreAllMocks());

describe("Code new thread", () => {
  it("drops the project's default model when another agent is picked", async () => {
    const create = vi.spyOn(codeApi, "create").mockResolvedValue({ threadId: "t1" });
    const user = userEvent.setup();
    render(
      <AppQueryProvider>
        <MemoryRouter>
          <NewThread
            focused={false}
            projects={[project]}
            harnesses={[
              harness("pi", "Native", true),
              harness("claude-code", "Claude Code", false),
            ]}
          />
        </MemoryRouter>
      </AppQueryProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Agent" }));
    await user.click(await screen.findByText("Claude Code"));
    await user.type(screen.getByTestId("code-new-message"), "fix it{Enter}");

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]![0]).toEqual({
      projectId: "p1",
      instanceId: "claude-code",
      message: "fix it",
    });
  });
});
