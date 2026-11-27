import React from "react";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { SettingsPage } from "@/pages/settings/SettingsPage";
import { usePeopleStore } from "@/store/people";

vi.mock("@groot/shell/components/NotificationSettings", () => ({
  NotificationSettings: () => <p>Notification settings</p>,
}));

function Where() {
  return <p data-testid="at">{useLocation().pathname}</p>;
}

describe("settings deep link", () => {
  it("keeps the linked section while the viewer's role loads", async () => {
    usePeopleStore.setState({ role: null });
    render(
      <MemoryRouter initialEntries={["/settings/notifications"]}>
        <Where />
        <Routes>
          <Route path="/settings/*" element={<SettingsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await act(async () => usePeopleStore.setState({ role: "owner" }));
    expect(screen.getByTestId("at").textContent).toBe("/settings/notifications");
    expect(await screen.findByText("Notification settings")).toBeTruthy();
  });
});
