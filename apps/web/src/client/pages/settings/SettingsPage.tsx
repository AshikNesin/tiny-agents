/**
 * The app's settings: the shell's full-page settings screen
 * (`@groot/shell/pages/settings/Settings`) with tiny-agents' own sections —
 * Models (issue #179), Notifications, People, Updates — beside Account, Appearance,
 * Security and Configuration. A guest (issue #145) gets Appearance and
 * Security only.
 */
import { useMemo } from "react";
import { AccountSettings } from "@groot/shell/components/AccountSettings";
import { AppSettings } from "@groot/shell/components/AppSettings";
import { NotificationSettings } from "@groot/shell/components/NotificationSettings";
import { PasskeyManager } from "@groot/shell/components/PasskeyManager";
import { ThemeSettings } from "@groot/shell/components/ThemeSettings";
import { Settings, type SettingsSection } from "@groot/shell/pages/settings/Settings";
import {
  Bell,
  Cpu,
  Download,
  FileJson,
  Palette,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import { PeopleSettings } from "../../components/PeopleSettings";
import { UpdatesSettings } from "../../components/UpdatesSettings";
import { useIsGuest } from "../../store/people";
import { ModelsSettings } from "./models/ModelsSettings";

const APPEARANCE: SettingsSection = {
  id: "appearance",
  label: "Appearance",
  group: "Personal",
  icon: Palette,
  description: "Customize how the app looks.",
  keywords: ["theme", "dark", "light", "system", "color", "mode"],
  element: <ThemeSettings />,
};

const SECURITY: SettingsSection = {
  id: "security",
  label: "Security",
  group: "Personal",
  icon: ShieldCheck,
  description: "Passkeys for passwordless sign-in.",
  keywords: [
    "passkey",
    "webauthn",
    "face id",
    "touch id",
    "security key",
    "biometric",
    "sign in",
    "login",
  ],
  element: <PasskeyManager />,
};

/** A guest sees only their own theme and sign-in (issue #145). */
const GUEST_SECTIONS: SettingsSection[] = [APPEARANCE, SECURITY];

/** The owner's settings, in sidebar order. */
export function SettingsPage() {
  const guest = useIsGuest();
  const sections = useMemo<SettingsSection[]>(
    () =>
      guest
        ? GUEST_SECTIONS
        : [
            {
              id: "account",
              label: "Account",
              group: "Personal",
              icon: UserRound,
              description: "Your profile and sign-in identity.",
              keywords: ["profile", "user", "me"],
              element: <AccountSettings />,
            },
            APPEARANCE,
            SECURITY,
            {
              id: "models",
              label: "Models",
              group: "App",
              icon: Cpu,
              description: "Provider accounts, their models and the default models.",
              keywords: [
                "anthropic",
                "openai",
                "gemini",
                "claude",
                "gateway",
                "api key",
                "provider",
              ],
              element: <ModelsSettings />,
              wide: true,
            },
            {
              id: "notifications",
              label: "Notifications",
              group: "App",
              icon: Bell,
              description: "Push notifications for waiting bots and routine results.",
              keywords: ["push", "pushover", "quiet hours", "digest"],
              element: <NotificationSettings />,
            },
            {
              id: "people",
              label: "People",
              group: "App",
              icon: Users,
              description: "Guests who can use the shared bots.",
              keywords: ["guests", "sharing", "invite"],
              element: <PeopleSettings />,
            },
            {
              id: "configuration",
              label: "Configuration",
              group: "App",
              icon: FileJson,
              description: "App-wide settings, shared by every user.",
              keywords: ["app settings", "json", "config", "key", "value", "feature flags"],
              element: <AppSettings />,
              wide: true,
            },
            {
              id: "updates",
              label: "Updates",
              group: "App",
              icon: Download,
              description: "Update a local install from git and restart it.",
              keywords: ["update", "upgrade", "version", "restart", "release", "git", "pnpm local"],
              element: <UpdatesSettings />,
            },
          ],
    [guest],
  );
  return <Settings sections={sections} />;
}
