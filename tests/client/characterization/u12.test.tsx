import React from "react";
import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router-dom";
import { appRoutes } from "@/App";
import { peopleApi } from "@/lib/people-api";
import { useViewerRole, usePeopleStore } from "@/store/people";

function gateElement(routes: RouteObject[]): React.ReactNode {
  for (const route of routes) {
    if (route.id === "guest-gate") return route.element;
    const found = gateElement(route.children ?? []);
    if (found) return found;
  }
  return undefined;
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        element: gateElement(appRoutes),
        children: [
          { path: "/chats", element: <p>Chats page</p> },
          { path: "/vault", element: <p>Vault page (owner only)</p> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

afterEach(() => {
  vi.restoreAllMocks();
  usePeopleStore.setState({ role: null });
});

describe("U12: who the shell thinks is signed in", () => {
  it("shows no owner page until /people/me answers, then sends a guest away", async () => {
    let answer: (value: { guest: boolean }) => void = () => undefined;
    vi.spyOn(peopleApi, "me").mockReturnValue(new Promise((resolve) => (answer = resolve)));
    usePeopleStore.setState({ role: null });
    const router = renderAt("/vault");
    const loading = usePeopleStore.getState().load();

    expect(screen.queryByText("Vault page (owner only)")).not.toBeInTheDocument();
    expect(renderHook(() => useViewerRole()).result.current).toBeNull();

    await act(async () => {
      answer({ guest: true });
      await loading;
    });
    expect(await screen.findByText("Chats page")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/chats");
  });

  it("keeps a failed /people/me from opening an owner page, and recovers on the next load", async () => {
    vi.spyOn(peopleApi, "me").mockRejectedValue(new Error("network down"));
    usePeopleStore.setState({ role: null });
    renderAt("/vault");
    await act(() => usePeopleStore.getState().load());

    expect(usePeopleStore.getState().role).toBeNull();
    expect(screen.queryByText("Vault page (owner only)")).not.toBeInTheDocument();
    expect(screen.queryByText("Chats page")).not.toBeInTheDocument();

    vi.mocked(peopleApi.me).mockResolvedValue({ guest: false });
    await act(() => usePeopleStore.getState().load());
    expect(await screen.findByText("Vault page (owner only)")).toBeInTheDocument();
  });

  it("still opens a guest page for a viewer whose /people/me failed", async () => {
    vi.spyOn(peopleApi, "me").mockRejectedValue(new Error("network down"));
    usePeopleStore.setState({ role: null });
    renderAt("/chats");
    await act(() => usePeopleStore.getState().load());

    expect(screen.getByText("Chats page")).toBeInTheDocument();
    expect(usePeopleStore.getState().role).toBeNull();
  });
});
