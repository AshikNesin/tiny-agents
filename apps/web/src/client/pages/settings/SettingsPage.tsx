/**
 * The app's settings: the shell's full-page settings screen
 * (`@groot/shell/pages/settings/Settings`) with tiny-agents' own sections —
 * Models (issue #179), Notifications, People, Updates — beside Account, Appearance,
 * Security and Configuration. A guest (issue #145) gets Appearance and
 * Security only. The section list itself is in `sections.ts`, shared with ⌘K.
 */
import { useMemo, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { AccountSettings } from "@groot/shell/components/AccountSettings";
import { AppSettings } from "@groot/shell/components/AppSettings";
import { NotificationSettings } from "@groot/shell/components/NotificationSettings";
import { PasskeyManager } from "@groot/shell/components/PasskeyManager";
import { ThemeSettings } from "@groot/shell/components/ThemeSettings";
import { Settings, type SettingsSection } from "@groot/shell/pages/settings/Settings";
import { PeopleSettings } from "../../components/PeopleSettings";
import { PhoneNotificationSettings } from "../../components/PhoneNotificationSettings";
import { UpdatesSettings } from "../../components/UpdatesSettings";
import { useIsGuest } from "../../store/people";
import { ModelsSettings } from "./models/ModelsSettings";
import { settingsSectionsFor } from "./sections";

/** Each section's body, by id. */
const ELEMENTS: Record<string, ReactNode> = {
  account: <AccountSettings />,
  appearance: <ThemeSettings />,
  security: <PasskeyManager />,
  models: <ModelsSettings />,
  notifications: (
    <NotificationSettings
      destinations={[{ id: "webpush", label: "Phone app", details: <PhoneNotificationSettings /> }]}
    />
  ),
  people: <PeopleSettings />,
  configuration: <AppSettings />,
  updates: <UpdatesSettings />,
};

/**
 * Settings were tabs on `/settings?tab=<id>` before the full-page screen;
 * those links (bookmarks, older docs) land on the section they meant. A
 * section the viewer lacks falls through to `Settings`' first-section redirect.
 */
const LEGACY_TABS: Record<string, string> = { general: "account", claude: "models" };

/** The viewer's settings, in sidebar order. */
export function SettingsPage() {
  const { pathname, search } = useLocation();
  const legacyTab = new URLSearchParams(search).get("tab");
  const guest = useIsGuest();
  const sections = useMemo<SettingsSection[]>(
    () => settingsSectionsFor(guest).map((s) => ({ ...s, element: ELEMENTS[s.id] })),
    [guest],
  );
  if (legacyTab && pathname.replace(/\/+$/, "") === "/settings") {
    return <Navigate to={`/settings/${LEGACY_TABS[legacyTab] ?? legacyTab}`} replace />;
  }
  return <Settings sections={sections} />;
}
