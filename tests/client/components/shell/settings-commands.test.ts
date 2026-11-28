import { describe, expect, it } from "vite-plus/test";
import { settingsCommandGroup } from "@/components/shell/settings-commands";
import { ApiFailure, fakeApi } from "../../fakes/api";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the ⌘K Settings group", () => {
  it("opens each of the owner's sections, and can check for updates", () => {
    const opened: string[] = [];
    const group = settingsCommandGroup(false, false, (to) => opened.push(to));
    expect(group.heading).toBe("Settings");
    expect(group.items.map((i) => i.label)).toEqual([
      "Account",
      "Appearance",
      "Security",
      "Models",
      "Tools",
      "Notifications",
      "People",
      "Configuration",
      "Updates",
      "Check for updates",
    ]);
    group.items.find((i) => i.label === "Notifications")!.onSelect();
    expect(opened).toEqual(["/settings/notifications"]);
  });

  it("adds Code's Projects, GitHub and Reviews when Code is set up", () => {
    const opened: string[] = [];
    const group = settingsCommandGroup(false, true, (to) => opened.push(to));
    expect(group.items.map((i) => i.label)).toEqual([
      "Account",
      "Appearance",
      "Security",
      "Models",
      "Tools",
      "Notifications",
      "People",
      "Configuration",
      "Updates",
      "Projects",
      "GitHub",
      "Reviews",
      "Check for updates",
    ]);
    group.items.find((i) => i.label === "Projects")!.onSelect();
    expect(opened).toEqual(["/settings/projects"]);
  });

  it("gives a guest only Appearance and Security, with no update check", () => {
    const group = settingsCommandGroup(true, true, () => undefined);
    expect(group.items.map((i) => i.label)).toEqual(["Appearance", "Security"]);
  });

  it("checks for updates, then opens Updates even when the server refuses", async () => {
    const api = fakeApi();
    api.post("/system/update/check", () => {
      throw new ApiFailure(409, "An update is already running", "CONFLICT");
    });
    const opened: string[] = [];
    const group = settingsCommandGroup(false, false, (to) => opened.push(to));
    group.items.find((i) => i.label === "Check for updates")!.onSelect();
    await flush();
    expect(api.sent("POST", "/system/update/check")).toHaveLength(1);
    expect(opened).toEqual(["/settings/updates"]);
  });
});
