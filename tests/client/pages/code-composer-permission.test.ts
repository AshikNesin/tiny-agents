import { describe, expect, it } from "vite-plus/test";
import { composerPermission } from "@/pages/code/controls";

describe("the new-thread composer's permission mode", () => {
  it("starts in YOLO when the harness offers it", () => {
    expect(
      composerPermission({
        permissionModes: ["default", "acceptEdits", "plan", "bypassPermissions"],
        defaultPermissionMode: "acceptEdits",
      }),
    ).toBe("bypassPermissions");
  });

  it("falls back to the harness default when YOLO is not offered (a guest)", () => {
    expect(
      composerPermission({
        permissionModes: ["default", "acceptEdits", "plan"],
        defaultPermissionMode: "acceptEdits",
      }),
    ).toBe("acceptEdits");
  });

  it("shows no mode for a harness without permission modes", () => {
    expect(composerPermission({ permissionModes: [] })).toBeNull();
  });
});
