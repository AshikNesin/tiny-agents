/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { Composer } from "@/pages/code/Composer";
import type { HarnessInfo } from "@/lib/code/api";
import { NO_CAPABILITIES } from "../../../packages/code/src/contracts/capabilities";
import { fakeApi } from "../fakes/api";
import { AppQueryProvider } from "../query-provider";

const harness = {
  id: "pi",
  kind: "pi",
  label: "Native",
  status: { state: "ready" },
  capabilities: NO_CAPABILITIES,
  commands: [],
  ssh: null,
} as unknown as HarnessInfo;

beforeEach(() => {
  fakeApi();
  window.localStorage.clear();
});

function open(onSend: (text: string) => Promise<void>) {
  return render(
    <AppQueryProvider>
      <Composer draftKey="t1" harness={harness} cwd="/repo" threadId="t1" onSend={onSend} />
    </AppQueryProvider>,
  );
}

describe("Code composer draft", () => {
  it("does not send a message twice when the thread is left and reopened while it sends", async () => {
    const sent: string[] = [];
    let delivered: () => void = () => undefined;
    const onSend = (text: string) => {
      sent.push(text);
      return new Promise<void>((resolve) => (delivered = resolve));
    };
    const user = userEvent.setup();
    const first = open(onSend);
    await user.type(screen.getByRole("textbox"), "ship it{Enter}");
    await waitFor(() => expect(sent).toEqual(["ship it"]));
    first.unmount();

    open(onSend);
    const box = screen.getByRole("textbox");
    expect(box).toHaveValue("ship it");
    await user.type(box, "{Enter}");
    expect(sent).toEqual(["ship it"]);

    delivered();
    await waitFor(() => expect(box).toHaveValue(""));
  });
});
