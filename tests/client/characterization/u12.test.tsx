import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router-dom";
import { appRoutes } from "@/App";
import type { PeopleMe } from "../../../apps/web/src/shared/api/people";
import { ApiFailure, fakeApi } from "../fakes/api";
import { ViewerProbe } from "../fakes/viewer";
import { AppQueryProvider } from "../query-provider";

let api: ReturnType<typeof fakeApi>;

function peopleMeFails() {
  api.get("/people/me", () => {
    throw new ApiFailure(503, "network down");
  });
}

beforeEach(() => {
  api = fakeApi();
});

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
  render(
    <AppQueryProvider>
      <ViewerProbe />
      <RouterProvider router={router} />
    </AppQueryProvider>,
  );
  return router;
}

const viewer = () => screen.getByTestId("viewer").textContent;
const asked = () => api.sent("GET", "/people/me");

describe("U12: who the shell thinks is signed in", () => {
  it("shows no owner page until /people/me answers, then sends a guest away", async () => {
    let answer: (value: PeopleMe) => void = () => undefined;
    api.get("/people/me", () => new Promise<PeopleMe>((resolve) => (answer = resolve)));
    const router = renderAt("/vault");
    await waitFor(() => expect(asked()).toHaveLength(1));

    expect(screen.queryByText("Vault page (owner only)")).not.toBeInTheDocument();
    expect(viewer()).toBe("loading");

    await act(async () => answer({ guest: true }));
    expect(await screen.findByText("Chats page")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/chats");
  });

  it("keeps a failed /people/me from opening an owner page, and recovers on the next load", async () => {
    peopleMeFails();
    renderAt("/vault");
    await waitFor(() => expect(viewer()).toBe("unknown"));

    expect(screen.queryByText("Vault page (owner only)")).not.toBeInTheDocument();
    expect(screen.queryByText("Chats page")).not.toBeInTheDocument();

    api.get("/people/me", (): PeopleMe => ({ guest: false }));
    cleanup();
    renderAt("/vault");
    expect(await screen.findByText("Vault page (owner only)")).toBeInTheDocument();
  });

  it("still opens a guest page for a viewer whose /people/me failed", async () => {
    peopleMeFails();
    renderAt("/chats");
    await waitFor(() => expect(viewer()).toBe("unknown"));

    expect(screen.getByText("Chats page")).toBeInTheDocument();
  });
});
