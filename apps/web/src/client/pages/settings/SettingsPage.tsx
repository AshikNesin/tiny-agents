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
import { ToolDefaultsSettings } from "../../components/ToolDefaultsSettings";
import { UpdatesSettings } from "../../components/UpdatesSettings";
import { useViewer, viewerRole } from "../../queries/viewer";
import { useCodeStore } from "../../store/code";
import { CodeSettingsSection } from "../code/CodeSettings";
import { ModelsSettings } from "./models/ModelsSettings";
import { settingsSectionsFor, type SettingsSectionId } from "./sections";

const ELEMENTS: Record<SettingsSectionId, ReactNode> = {
  account: <AccountSettings />,
  appearance: <ThemeSettings />,
  security: <PasskeyManager />,
  models: <ModelsSettings />,
  tools: <ToolDefaultsSettings />,
  notifications: (
    <NotificationSettings
      destinations={[{ id: "webpush", label: "Phone app", details: <PhoneNotificationSettings /> }]}
    />
  ),
  people: <PeopleSettings />,
  configuration: <AppSettings />,
  updates: <UpdatesSettings />,
  projects: <CodeSettingsSection section="projects" />,
  github: <CodeSettingsSection section="github" />,
  reviews: <CodeSettingsSection section="reviews" />,
};

const LEGACY_TABS: Record<string, string> = { general: "account", claude: "models" };

export function SettingsPage() {
  const { pathname, search } = useLocation();
  const legacyTab = new URLSearchParams(search).get("tab");
  const role = viewerRole(useViewer());
  const restricted = role !== "owner";
  const code = useCodeStore((s) => s.harnesses === null || s.harnesses.length > 0);
  const sections = useMemo<SettingsSection[]>(
    () => settingsSectionsFor(restricted, code).map((s) => ({ ...s, element: ELEMENTS[s.id] })),
    [restricted, code],
  );
  if (legacyTab && pathname.replace(/\/+$/, "") === "/settings") {
    return <Navigate to={`/settings/${LEGACY_TABS[legacyTab] ?? legacyTab}`} replace />;
  }
  if (role === "loading" || role === "unknown") return null;
  return <Settings sections={sections} />;
}
