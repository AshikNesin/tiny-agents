import React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { GrootUIProvider } from "@groot/ui/provider";
import type {
  NotificationLogRow,
  NotificationSettingsResponse,
  NotificationStatus,
} from "@groot/shell/services/notifications";
import { SettingsPage } from "@/pages/settings/SettingsPage";
import { usePeopleStore } from "@/store/people";
import type {
  AccountList,
  ModelsResponse,
  RolesResponse,
} from "../../../apps/web/src/shared/api/models";
import type { GuestList } from "../../../apps/web/src/shared/api/people";
import type { PushDeviceList } from "../../../apps/web/src/shared/api/push";
import { fakeApi } from "../fakes/api";
import { AppQueryProvider } from "../query-provider";

const unset = { modelId: null, fallback: true };
const accounts: AccountList = { accounts: [], templates: [] };
const roles: RolesResponse = {
  roles: {
    bot_default: unset,
    code_default: unset,
    memory_capture: unset,
    chat_title: unset,
    vision: unset,
    classifier: unset,
  },
};
const models: ModelsResponse = {
  models: [],
  defaultModelId: null,
  canAnswer: false,
  providers: [],
};
const guests: GuestList = { guests: [] };
const devices: PushDeviceList = { devices: [] };
const notificationStatus: NotificationStatus = {
  channel: "pushover",
  state: "not_configured",
  requiredEnv: [],
  devices: [],
};
const notificationSettings: NotificationSettingsResponse = {
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
const notificationLog: NotificationLogRow[] = [];

function Where() {
  const location = useLocation();
  return <p data-testid="at">{location.pathname + location.search}</p>;
}

beforeEach(() => {
  const api = fakeApi();
  api.get("/models/providers", () => accounts);
  api.get("/models/roles", () => roles);
  api.get("/models", () => models);
  api.get("/people", () => guests);
  api.get("/passkey/list", () => []);
  api.get("/notifications/status", () => notificationStatus);
  api.get("/notifications/settings", () => notificationSettings);
  api.get("/notifications/log", () => notificationLog);
  api.get("/notifications/devices", () => devices);
  usePeopleStore.setState({ role: "owner" });
});

afterEach(() => {
  usePeopleStore.setState({ role: null });
});

function at(entry: string) {
  render(
    <AppQueryProvider>
      <GrootUIProvider>
        <MemoryRouter initialEntries={[entry]}>
          <Where />
          <Routes>
            <Route path="/settings/*" element={<SettingsPage />} />
          </Routes>
        </MemoryRouter>
      </GrootUIProvider>
    </AppQueryProvider>,
  );
  return screen.getByTestId("at").textContent;
}

describe("legacy settings tabs", () => {
  it.each([
    ["/settings?tab=models", "/settings/models", "Models"],
    ["/settings?tab=notifications", "/settings/notifications", "Notifications"],
    ["/settings?tab=people", "/settings/people", "People"],
    ["/settings?tab=security", "/settings/security", "Security"],
    ["/settings?tab=general", "/settings/account", "Account"],
    ["/settings?tab=claude", "/settings/models", "Models"],
  ])("%s lands on %s", (from, to, section) => {
    expect(at(from)).toBe(to);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(section);
  });

  it("leaves a section's own query alone", () => {
    expect(at("/settings/models?tab=x")).toBe("/settings/models?tab=x");
  });
});
