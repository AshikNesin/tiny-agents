import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { settingsCommandGroup } from "@/components/shell/settings-commands";
import { updatesApi } from "@/lib/updates-api";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => vi.restoreAllMocks());

describe("the ⌘K Settings group", () => {
  it("opens each of the owner's sections, and can check for updates", () => {
    const opened: string[] = [];
    const group = settingsCommandGroup(false, (to) => opened.push(to));
    expect(group.heading).toBe("Settings");
    expect(group.items.map((i) => i.label)).toEqual([
      "Account",
      "Appearance",
      "Security",
      "Models",
      "Notifications",
      "People",
      "Configuration",
      "Updates",
      "Check for updates",
    ]);
    group.items.find((i) => i.label === "Notifications")!.onSelect();
    expect(opened).toEqual(["/settings/notifications"]);
  });

  it("gives a guest only Appearance and Security, with no update check", () => {
    const group = settingsCommandGroup(true, () => undefined);
    expect(group.items.map((i) => i.label)).toEqual(["Appearance", "Security"]);
  });

  it("checks for updates, then opens Updates even when the server refuses", async () => {
    const check = vi.spyOn(updatesApi, "check").mockRejectedValue(new Error("409"));
    const opened: string[] = [];
    const group = settingsCommandGroup(false, (to) => opened.push(to));
    group.items.find((i) => i.label === "Check for updates")!.onSelect();
    await flush();
    expect(check).toHaveBeenCalledTimes(1);
    expect(opened).toEqual(["/settings/updates"]);
  });
});
