import React from "react";
import { act, screen, waitFor } from "@testing-library/react";
import { expect } from "vite-plus/test";
import { useViewer, viewerRole } from "@/queries/viewer";
import type { PeopleMe } from "../../../apps/web/src/shared/api/people";
import type { fakeApi } from "./api";

type Role = "owner" | "guest";

export function signedInAs(api: Pick<ReturnType<typeof fakeApi>, "get">, role: Role) {
  api.get("/people/me", (): PeopleMe => ({ guest: role === "guest" }));
}

export function ViewerProbe() {
  return <output data-testid="viewer">{viewerRole(useViewer())}</output>;
}

export async function viewerShown(role: Role) {
  await screen.findByText(role, { selector: "[data-testid=viewer]" });
}

export async function viewerLoaded(api: Pick<ReturnType<typeof fakeApi>, "sent">) {
  await waitFor(() => expect(api.sent("GET", "/people/me")).not.toHaveLength(0));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
