/**
 * The suggested next message in a Code thread's composer: shown as the
 * empty composer's placeholder, Tab fills it in, Esc dismisses it, and it
 * is gone while the agent works.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { NO_CAPABILITIES } from "@tiny-agents/code/contracts";
import { Composer } from "@/pages/code/Composer";
import type { HarnessInfo } from "@/lib/code/api";
import { AppQueryProvider } from "../query-provider";

const harness: HarnessInfo = {
  id: "fake",
  kind: "fake",
  label: "Fake",
  status: { state: "connected" },
  capabilities: NO_CAPABILITIES,
  commands: [],
};

const composer = (props: Partial<React.ComponentProps<typeof Composer>>) => (
  <AppQueryProvider>
    <Composer draftKey="fake:c1" harness={harness} onSend={async () => {}} {...props} />
  </AppQueryProvider>
);

// The composer keeps its draft per thread: each test starts empty.
afterEach(() => localStorage.clear());

describe("the suggested next message", () => {
  it("is the placeholder, and Tab fills it in", async () => {
    const user = userEvent.setup();
    render(composer({ nextPrompt: { text: "Run the tests", dismiss: () => {} } }));
    const box = screen.getByRole("textbox", { name: "Message Fake" });
    expect(box).toHaveAttribute("placeholder", "Run the tests");
    expect(screen.getByTestId("code-composer-hint")).toHaveTextContent(
      "Tab uses the suggestion · Esc dismisses it",
    );
    await user.click(box);
    await user.keyboard("{Tab}");
    expect(box).toHaveValue("Run the tests");
  });

  it("is dismissed with Esc, and not offered while the agent works", async () => {
    const user = userEvent.setup();
    const dismiss = vi.fn();
    const { rerender } = render(composer({ nextPrompt: { text: "Open a PR", dismiss } }));
    const box = screen.getByRole("textbox", { name: "Message Fake" });
    await user.click(box);
    await user.keyboard("{Escape}");
    expect(dismiss).toHaveBeenCalledOnce();
    expect(box).toHaveValue("");

    rerender(composer({ working: true, nextPrompt: { text: "Open a PR", dismiss } }));
    expect(box).not.toHaveAttribute("placeholder", "Open a PR");
  });
});
