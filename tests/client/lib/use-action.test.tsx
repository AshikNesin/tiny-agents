/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { act, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { ConfirmProvider, useConfirm } from "@groot/ui/primitives";
import { createShellQueryClient, ShellQueryProvider } from "@groot/shell/lib/query-client";
import { useAction } from "@groot/shell/lib/feedback";

function wrapper({ children }: { children: ReactNode }) {
  return (
    <ShellQueryProvider client={createShellQueryClient()}>
      <ConfirmProvider>{children}</ConfirmProvider>
    </ShellQueryProvider>
  );
}

describe("useAction's run: idle → confirming → running → idle", () => {
  it("ignores a second run while one is under way, then runs again once idle", async () => {
    let finish!: () => void;
    const action = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { result } = renderHook(() => useAction(action, { fallback: "Failed" }), { wrapper });

    let first!: Promise<unknown>;
    act(() => {
      first = result.current.run();
    });
    await waitFor(() => expect(result.current.isPending).toBe(true));
    await expect(result.current.run()).resolves.toEqual({ ok: false, reason: "busy" });

    finish();
    await act(async () => {
      await expect(first).resolves.toEqual({ ok: true, data: undefined });
    });
    expect(result.current.isPending).toBe(false);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("ends as cancelled, without running, when the person declines", async () => {
    const action = vi.fn(async () => "done");
    const { result } = renderHook(
      () => useAction(action, { confirm: { title: "Sure?" }, fallback: "Failed" }),
      { wrapper },
    );
    const user = userEvent.setup();

    let run!: Promise<unknown>;
    act(() => {
      run = result.current.run();
    });

    expect(result.current.isPending).toBe(false);
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }),
    );
    await expect(run).resolves.toEqual({ ok: false, reason: "cancelled" });
    expect(action).not.toHaveBeenCalled();
  });

  it("ends as failed with the error and is idle again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("Nope");
    const { result } = renderHook(
      () => useAction(async () => Promise.reject(error), { fallback: "Failed" }),
      { wrapper },
    );
    await act(async () => {
      await expect(result.current.run()).resolves.toEqual({ ok: false, reason: "failed", error });
    });
    expect(result.current.isPending).toBe(false);
  });
});

describe("ConfirmProvider", () => {
  it("resolves an open confirmation false when a newer one replaces it", async () => {
    const { result } = renderHook(() => useConfirm(), { wrapper });
    const user = userEvent.setup();

    let older!: Promise<boolean>;
    let newer!: Promise<boolean>;
    act(() => {
      older = result.current({ title: "First?" });
    });
    act(() => {
      newer = result.current({ title: "Second?" });
    });
    await expect(older).resolves.toBe(false);

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Second?")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await expect(newer).resolves.toBe(true);
  });
});
