import type { SettingsSection } from "@groot/shell/pages/settings/Settings";
import {
  Bell,
  Cpu,
  Download,
  FileJson,
  Palette,
  ShieldCheck,
  UserRound,
  Users,
  Wrench,
} from "lucide-react";

export type SettingsSectionInfo = Omit<SettingsSection, "element" | "items">;

const OWNER_SECTIONS: SettingsSectionInfo[] = [
  {
    id: "account",
    label: "Account",
    group: "Personal",
    icon: UserRound,
    description: "Your profile and sign-in identity.",
    keywords: ["profile", "user", "me"],
  },
  {
    id: "appearance",
    label: "Appearance",
    group: "Personal",
    icon: Palette,
    description: "Customize how the app looks.",
    keywords: ["theme", "dark", "light", "system", "color", "mode"],
  },
  {
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
  },
  {
    id: "models",
    label: "Models",
    group: "App",
    icon: Cpu,
    description: "Provider accounts, their models and the default models.",
    keywords: ["anthropic", "openai", "gemini", "claude", "gateway", "api key", "provider"],
    wide: true,
  },
  {
    id: "tools",
    label: "Tools",
    group: "App",
    icon: Wrench,
    description: "Allow, Ask or Off for each tool, once for every bot.",
    keywords: ["permissions", "allow", "ask", "approval", "bots", "always allow"],
  },
  {
    id: "notifications",
    label: "Notifications",
    group: "App",
    icon: Bell,
    description: "Push notifications for waiting bots and routine results.",
    keywords: ["push", "pushover", "phone", "android", "quiet hours", "digest"],
  },
  {
    id: "people",
    label: "People",
    group: "App",
    icon: Users,
    description: "Guests who can use the shared bots.",
    keywords: ["guests", "sharing", "invite"],
  },
  {
    id: "configuration",
    label: "Configuration",
    group: "App",
    icon: FileJson,
    description: "App-wide settings, shared by every user.",
    keywords: ["app settings", "json", "config", "key", "value", "feature flags"],
    wide: true,
  },
  {
    id: "updates",
    label: "Updates",
    group: "App",
    icon: Download,
    description: "Update a local install from git and restart it.",
    keywords: ["update", "upgrade", "version", "restart", "release", "git", "pnpm local"],
  },
];

const GUEST_SECTION_IDS = new Set(["appearance", "security"]);

export function settingsSectionsFor(guest: boolean): SettingsSectionInfo[] {
  return guest ? OWNER_SECTIONS.filter((s) => GUEST_SECTION_IDS.has(s.id)) : OWNER_SECTIONS;
}
