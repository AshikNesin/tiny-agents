/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vite-plus/test";
import { NewThread } from "@/pages/code/NewThread";
import type { HarnessInfo, ModelOption } from "@/lib/code/api";
import type { ProjectView } from "../../../apps/web/src/shared/api/code";
import { NO_CAPABILITIES } from "../../../packages/code/src/contracts/capabilities";
import { fakeApi } from "../fakes/api";
import { AppQueryProvider } from "../query-provider";

const models: ModelOption[] = [{ id: "pi-opus", label: "Opus", ready: true }];

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

describe("Code new thread", () => {
  it("drops the project's default model when another agent is picked", async () => {
    const api = fakeApi();
    api.get("/code/harnesses/:instanceId/models", () => models);
    api.post("/code/threads", () => ({ threadId: "t1" }));
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

    await waitFor(() => expect(api.sent("POST", "/code/threads")).toHaveLength(1));
    expect(api.sent("POST", "/code/threads")[0]!.body).toEqual({
      projectId: "p1",
      instanceId: "claude-code",
      message: "fix it",
    });
  });
});
