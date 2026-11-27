/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { Composer } from "@/pages/code/Composer";
import type { HarnessInfo } from "@/lib/code/api";
import { NO_CAPABILITIES } from "../../../packages/code/src/contracts/capabilities";
import { AppQueryProvider } from "../query-provider";

vi.mock("@groot/shell/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@groot/shell/lib/api")>();
  return {
    ...original,
    apiClient: Object.assign(Object.create(original.apiClient) as typeof original.apiClient, {
      get: async (path: string) =>
        path.endsWith("/skills")
          ? [
              { name: "show-me", description: "Explain it visually" },
              { name: "release-notes", description: "Write release notes" },
            ]
          : null,
    }),
  };
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
});
