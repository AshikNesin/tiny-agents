/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ChatWorkspace } from "@/pages/chats/ChatsLayout";
import { useBotsStore } from "@/store/bots";
import { useUiStore } from "@/store/ui";
import { fakeApi } from "../fakes/api";
import { signedInAs } from "../fakes/viewer";
import { AppQueryProvider } from "../query-provider";

describe("Chats with no bots yet", () => {
  it("still offers the menu button, so the rest of the app is reachable", async () => {
    useBotsStore.setState({ bots: [], loading: false });
    useUiStore.setState({ mobileOpen: false });
    signedInAs(fakeApi(), "owner");
    render(
      <MemoryRouter initialEntries={["/chats"]}>
        <Routes>
          <Route path="/chats" element={<ChatWorkspace />} />
        </Routes>
      </MemoryRouter>,
      { wrapper: AppQueryProvider },
    );
    expect(screen.getByRole("heading", { name: "Create your first bot" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(useUiStore.getState().mobileOpen).toBe(true);
  });
});
