import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { GrootUIProvider } from "@groot/ui/provider";
import type {
  NotificationLogRow,
  NotificationSettingsResponse,
  NotificationStatus,
} from "@groot/shell/services/notifications";
import { SettingsPage } from "@/pages/settings/SettingsPage";
import type { PushDeviceList } from "../../../apps/web/src/shared/api/push";
import { fakeApi } from "../fakes/api";
import { AppQueryProvider } from "../query-provider";
import type { PeopleMe } from "../../../apps/web/src/shared/api/people";

const status: NotificationStatus = {
  channel: "pushover",
  state: "not_configured",
  requiredEnv: [],
  devices: [],
};
const settings: NotificationSettingsResponse = {
  settings: {
    deliverTo: "off",
    events: {},
    quietHours: {
      enabled: false,
      start: "22:00",
      end: "07:00",
      timezone: "UTC",
      urgentBypass: true,
    },
    device: "",
    longRunMinutes: 5,
    coalesceSeconds: 30,
    reminderMinutes: 0,
    throttle: { perHour: 20, perBotPerMinute: 2 },
  },
  events: [],
};
const log: NotificationLogRow[] = [];
const devices: PushDeviceList = { devices: [] };

function Where() {
  return <p data-testid="at">{useLocation().pathname}</p>;
}

describe("settings deep link", () => {
  it("keeps the linked section while the viewer's role loads", async () => {
    const api = fakeApi();
    api.get("/notifications/status", () => status);
    api.get("/notifications/settings", () => settings);
    api.get("/notifications/log", () => log);
    api.get("/notifications/devices", () => devices);
    let answer: (value: PeopleMe) => void = () => undefined;
    api.get("/people/me", () => new Promise<PeopleMe>((resolve) => (answer = resolve)));
    render(
      <AppQueryProvider>
        <GrootUIProvider>
          <MemoryRouter initialEntries={["/settings/notifications"]}>
            <Where />
            <Routes>
              <Route path="/settings/*" element={<SettingsPage />} />
            </Routes>
          </MemoryRouter>
        </GrootUIProvider>
      </AppQueryProvider>,
    );
    await waitFor(() =>
      expect(api.requests.map((request) => request.path)).toEqual(["/people/me"]),
    );
    await act(async () => answer({ guest: false }));
    expect(await screen.findByText("Recent notifications")).toBeTruthy();
    expect(screen.getByTestId("at").textContent).toBe("/settings/notifications");
    expect(screen.getByText("Nothing sent yet.")).toBeTruthy();
  });
});
