/**
 * @vitest-environment jsdom
 *
 * Vault step-up: one prompt answers everyone who asked while it was open,
 * and a dismissal lets them all go, so no `run()` is left waiting forever.
 */
import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { vaultApi } from "@/lib/vault-api";
import { StepUpProvider, useStepUp } from "@/components/vault/StepUp";
import { fakeApi } from "../fakes/api";
import type { StepUpToken } from "../../../apps/web/src/shared/api/vault";

let api: ReturnType<typeof fakeApi>;

let run!: ReturnType<typeof useStepUp>["run"];
function Probe() {
  run = useStepUp().run;
  return null;
}

beforeEach(() => {
  vaultApi.forgetStepUp();
  api = fakeApi();
});

describe("StepUpProvider", () => {
  it("one confirmation answers two concurrent asks", async () => {
    api.post("/vault/step-up", (): StepUpToken => ({
      token: "step-up-1",
      expiresAt: Date.now() + 300_000,
    }));
    render(
      <StepUpProvider>
        <Probe />
      </StepUpProvider>,
    );
    const first = vi.fn(async () => "one");
    const second = vi.fn(async () => "two");
    let results!: Promise<[string | undefined, string | undefined]>;
    act(() => {
      results = Promise.all([run(first), run(second)]);
    });
    expect(await screen.findByLabelText("Password")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Password"), "hunter2");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await results).toEqual(["one", "two"]);
    expect(api.sent("POST", "/vault/step-up").map((request) => request.body)).toEqual([
      { password: "hunter2" },
    ]);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("a dismissal releases every waiting ask with no result", async () => {
    render(
      <StepUpProvider>
        <Probe />
      </StepUpProvider>,
    );
    const work = vi.fn(async () => "x");
    let results!: Promise<[string | undefined, string | undefined]>;
    act(() => {
      results = Promise.all([run(work), run(work)]);
    });
    await screen.findByLabelText("Password");
    const user = userEvent.setup();
    await user.keyboard("{Escape}");
    expect(await results).toEqual([undefined, undefined]);
    expect(work).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByLabelText("Password")).not.toBeInTheDocument());
  });
});
