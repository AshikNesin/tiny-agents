/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Composer } from "@/pages/code/Composer";
import type { HarnessInfo, Skill, ToolChoice } from "@/lib/code/api";
import { NO_CAPABILITIES } from "../../../packages/code/src/contracts/capabilities";
import { fakeApi } from "../fakes/api";
import { AppQueryProvider } from "../query-provider";

const tools: ToolChoice[] = [
  {
    name: "mcp__github__list_issues",
    label: "List issues",
    description: "Open issues",
    connection: { slug: "github", name: "GitHub" },
  },
];
const skills: Skill[] = [
  { name: "show-me", description: "Explain it visually" },
  { name: "release-notes", description: "Write release notes" },
  { name: "v2-notes", description: "Notes for v2" },
];

beforeEach(() => {
  const api = fakeApi();
  api.get("/code/harnesses/:instanceId/tools", () => tools);
  api.get("/code/harnesses/:instanceId/skills", () => skills);
});

const harness = {
  id: "pi",
  kind: "pi",
  label: "Native",
  status: { state: "ready" },
  capabilities: {
    ...NO_CAPABILITIES,
    workspace: {
      ...NO_CAPABILITIES.workspace,
      skills: true,
      requiresCwd: true,
    },
    extras: { ...NO_CAPABILITIES.extras, commands: true },
  },
  commands: [{ command: "/compact", hint: "Summarize" }],
  ssh: null,
} as unknown as HarnessInfo;

describe("Code composer slash skills", () => {
  it("lists skills after / and sends the picked one with the message", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(
      <AppQueryProvider>
        <Composer draftKey="t1" harness={harness} cwd="/work" threadId="t1" onSend={onSend} />
      </AppQueryProvider>,
    );
    const box = screen.getByRole("textbox");

    await user.type(box, "/sh");
    await waitFor(() =>
      expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
        "show-meExplain it visually",
      ]),
    );
    await user.keyboard("{Enter}");
    expect(box).toHaveValue("");
    expect(screen.getByTestId("code-composer-chips")).toHaveTextContent("show-me");

    await user.type(box, "draw the repo{Enter}");
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend.mock.calls[0]![0]).toBe("draw the repo");
    expect(onSend.mock.calls[0]![1]).toMatchObject({ skills: ["show-me"] });
  });

  it("lists a skill whose name has a digit", async () => {
    const user = userEvent.setup();
    render(
      <AppQueryProvider>
        <Composer draftKey="t2" harness={harness} cwd="/work" threadId="t2" onSend={vi.fn()} />
      </AppQueryProvider>,
    );

    await user.type(screen.getByRole("textbox"), "/v2");

    await waitFor(() =>
      expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
        "v2-notesNotes for v2",
      ]),
    );
  });

  it("keeps what is typed right after picking a skill where it was typed", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => frames.push(run));
    const user = userEvent.setup();
    render(
      <AppQueryProvider>
        <Composer draftKey="t3" harness={harness} cwd="/work" threadId="t3" onSend={vi.fn()} />
      </AppQueryProvider>,
    );
    const box = screen.getByRole("textbox");
    await user.type(box, "/sh");
    await screen.findByRole("option", { name: /show-me/ });

    await user.keyboard("{Enter}dr");
    for (const run of frames.splice(0)) run(0);
    await user.keyboard("aw");

    expect(box).toHaveValue("draw");
  });

  it("lists the harness's tools after / and sends the picked one as a chip", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(
      <AppQueryProvider>
        <Composer draftKey="t4" harness={harness} cwd="/work" threadId="t4" onSend={onSend} />
      </AppQueryProvider>,
    );
    const box = screen.getByRole("textbox");

    await user.type(box, "/git");
    await waitFor(() =>
      expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
        "githubEvery GitHub tool (1)",
        "List issuesGitHub · Open issues",
      ]),
    );
    await user.keyboard("{ArrowDown}{Enter}");
    expect(box).toHaveValue("");
    expect(screen.getByTestId("code-composer-chips")).toHaveTextContent("GitHub: List issues");

    await user.type(box, "triage them{Enter}");
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend.mock.calls[0]![0]).toBe("triage them");
    expect(onSend.mock.calls[0]![1]).toMatchObject({ tools: ["mcp__github__list_issues"] });
  });
});
