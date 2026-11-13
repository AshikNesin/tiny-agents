/**
 * Settings were tabs on `/settings?tab=<id>` before the full-page screen
 * (issue #241): those links land on the section they meant, and `?tab=` off
 * the bare path is left alone.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { SettingsPage } from "@/pages/settings/SettingsPage";

// The screen itself (and its sections' data loading) is not under test here.
vi.mock("@groot/shell/pages/settings/Settings", () => ({
  Settings: function SettingsStub() {
    const location = useLocation();
    return <p data-testid="at">{location.pathname + location.search}</p>;
  },
}));
vi.mock("@/store/people", () => ({ useIsGuest: () => false }));

function at(entry: string) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/settings/*" element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.getByTestId("at").textContent;
}

describe("legacy settings tabs", () => {
  it.each([
    ["/settings?tab=models", "/settings/models"],
    ["/settings?tab=notifications", "/settings/notifications"],
    ["/settings?tab=people", "/settings/people"],
    ["/settings?tab=security", "/settings/security"],
    ["/settings?tab=general", "/settings/account"],
    ["/settings?tab=claude", "/settings/models"],
  ])("%s lands on %s", (from, to) => {
    expect(at(from)).toBe(to);
  });

  it("leaves a section's own query alone", () => {
    expect(at("/settings/models?tab=x")).toBe("/settings/models?tab=x");
  });
});
