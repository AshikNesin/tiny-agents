/**
 * The page resources (rewrite step 5.2) keep what the hand-rolled pages did:
 * a failure shows at once and stays while a retry runs, a revisit loads
 * again rather than showing a cached list, focus never refetches, and the
 * newest refresh's answer is the one shown.
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { useResource } from "@/queries/resource";
import { AppQueryProvider } from "../query-provider";

let refresh: () => Promise<void> = async () => {};

function Probe({ queryFn }: { queryFn: () => Promise<string> }) {
  const resource = useResource(["probe"], queryFn, "Failed to load");
  refresh = resource.refresh;
  if (resource.loadError) return <p>error: {resource.loadError}</p>;
  return <p>{resource.data ?? "loading"}</p>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useResource", () => {
  it("shows a failure at once, without retrying, and keeps it until a retry answers", async () => {
    const retry = deferred<string>();
    const queryFn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockReturnValueOnce(retry.promise);
    render(
      <AppQueryProvider>
        <Probe queryFn={queryFn} />
      </AppQueryProvider>,
    );

    expect(await screen.findByText("error: boom")).toBeTruthy();
    expect(queryFn).toHaveBeenCalledTimes(1);

    let refreshed!: Promise<void>;
    act(() => {
      refreshed = refresh();
    });
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
    expect(screen.getByText("error: boom")).toBeTruthy();

    await act(async () => {
      retry.resolve("tasks");
      await refreshed;
    });
    expect(await screen.findByText("tasks")).toBeTruthy();
  });

  it("loads again on a revisit and never refetches on focus", async () => {
    const queryFn = vi.fn(async () => "tasks");
    const first = render(
      <AppQueryProvider>
        <Probe queryFn={queryFn} />
      </AppQueryProvider>,
    );
    expect(await screen.findByText("tasks")).toBeTruthy();
    fireEvent.focus(window);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(queryFn).toHaveBeenCalledTimes(1);
    first.unmount();

    const later = deferred<string>();
    queryFn.mockReturnValueOnce(later.promise);
    render(
      <AppQueryProvider>
        <Probe queryFn={queryFn} />
      </AppQueryProvider>,
    );
    expect(screen.getByText("loading")).toBeTruthy();
    await act(async () => later.resolve("tasks again"));
    expect(await screen.findByText("tasks again")).toBeTruthy();
  });

  it("shows the newest refresh's answer when an older fetch lands later", async () => {
    const older = deferred<string>();
    const newer = deferred<string>();
    const queryFn = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("first")
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    render(
      <AppQueryProvider>
        <Probe queryFn={queryFn} />
      </AppQueryProvider>,
    );
    expect(await screen.findByText("first")).toBeTruthy();

    let a!: Promise<void>;
    let b!: Promise<void>;
    act(() => {
      a = refresh();
    });
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
    act(() => {
      b = refresh();
    });
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(3));

    await act(async () => {
      newer.resolve("newer");
      await b;
    });
    await act(async () => {
      older.resolve("older");
      await a;
    });
    expect(await screen.findByText("newer")).toBeTruthy();
    expect(screen.queryByText("older")).toBeNull();
  });
});
