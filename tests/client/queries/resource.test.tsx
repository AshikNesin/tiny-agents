import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { ResourceView } from "@/components/ResourceView";
import { useResource } from "@/queries/resource";
import { AppQueryProvider } from "../query-provider";

let refresh: () => Promise<void> = async () => {};

function Probe({ queryFn }: { queryFn: () => Promise<string> }) {
  const resource = useResource(["probe"], queryFn, "Failed to load");
  refresh = resource.refresh;
  if (resource.status === "failed") return <p>error: {resource.loadError}</p>;
  if (resource.status === "loading") return <p>loading</p>;
  return <p>{resource.data}</p>;
}

function LastProbe({ queryFn }: { queryFn: () => Promise<string> }) {
  const resource = useResource(["last-probe"], queryFn, "Failed to load");
  refresh = resource.refresh;
  if (resource.status === "loading") return <p>loading</p>;
  if (resource.status === "ready") return <p>ready: {resource.data}</p>;
  return (
    <p>
      failed: {resource.loadError}, last: {resource.last ?? "nothing"}
    </p>
  );
}

function ViewProbe({ queryFn }: { queryFn: () => Promise<string> }) {
  const resource = useResource(["view-probe"], queryFn, "Failed to load");
  return (
    <ResourceView resource={resource} failedTitle="Couldn't load tasks">
      {(data) => <p>ready: {data}</p>}
    </ResourceView>
  );
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

describe("useResource after a failed refresh", () => {
  it("fails with the earlier read as last, and with nothing when no read ever answered", async () => {
    const queryFn = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("tasks")
      .mockRejectedValueOnce(new Error("boom"));
    const loaded = render(
      <AppQueryProvider>
        <LastProbe queryFn={queryFn} />
      </AppQueryProvider>,
    );
    expect(await screen.findByText("ready: tasks")).toBeTruthy();

    await act(() => refresh());
    expect(await screen.findByText("failed: boom, last: tasks")).toBeTruthy();
    loaded.unmount();

    render(
      <AppQueryProvider>
        <LastProbe queryFn={() => Promise.reject(new Error("down"))} />
      </AppQueryProvider>,
    );
    expect(await screen.findByText("failed: down, last: nothing")).toBeTruthy();
  });
});

describe("ResourceView", () => {
  it("shows the failure with a Retry button, then the content once the retry answers", async () => {
    const first = deferred<string>();
    const retry = deferred<string>();
    const queryFn = vi
      .fn<() => Promise<string>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(retry.promise);
    render(
      <AppQueryProvider>
        <ViewProbe queryFn={queryFn} />
      </AppQueryProvider>,
    );

    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();

    await act(async () => first.reject(new Error("boom")));
    expect(await screen.findByText("Couldn't load tasks")).toBeTruthy();
    expect(screen.getByText("boom")).toBeTruthy();
    expect(screen.queryByText("Loading…")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("ready: tasks")).toBeNull();

    await act(async () => retry.resolve("tasks"));
    expect(await screen.findByText("ready: tasks")).toBeTruthy();
    expect(screen.queryByText("Couldn't load tasks")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});
