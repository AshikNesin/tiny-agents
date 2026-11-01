/**
 * The computer's command builders and parsers (issue #108): what xdotool,
 * wmctrl and the desktop entries print, and what never reaches a command
 * line.
 */
import { describe, expect, it } from "vite-plus/test";
import {
  computerStackReadyCommand,
  installComputerStackCommand,
  parseDesktopLaunch,
  parseDesktopSize,
  parseExtraPackages,
} from "../../../../packages/agent/src/toolkits/computer-vm-setup";
import {
  checkWindowId,
  clickBody,
  desktopProfileDir,
  keyBody,
  openAppBody,
  parseApps,
  parseCursor,
  parseWindows,
  screenshotBody,
  scrollBody,
} from "../../../../packages/agent/src/toolkits/computer-x11";

describe("computer x11 commands", () => {
  it("parses wmctrl's window list, skipping the panel and desktop", () => {
    const output = [
      "0x01e00003 -1 xfce4-panel.Xfce4-panel  vm xfce4-panel",
      "0x02200003  0 mousepad.Mousepad     vm Untitled 1 - Mousepad",
      "0x02400004  0 Thunar.Thunar         vm Home - File Manager",
      "--active",
      String(0x02200003),
    ].join("\n");
    expect(parseWindows(output)).toEqual([
      {
        id: "0x02200003",
        windowClass: "mousepad.Mousepad",
        title: "Untitled 1 - Mousepad",
        active: true,
      },
      {
        id: "0x02400004",
        windowClass: "Thunar.Thunar",
        title: "Home - File Manager",
        active: false,
      },
    ]);
  });

  it("parses desktop entries once each, sorted by name", () => {
    expect(
      parseApps("org.xfce.mousepad\tMousepad\nthunar\tFile Manager\norg.xfce.mousepad\tDup\n\n"),
    ).toEqual([
      { id: "thunar", name: "File Manager" },
      { id: "org.xfce.mousepad", name: "Mousepad" },
    ]);
  });

  it("parses the pointer position", () => {
    expect(parseCursor("X=640\nY=400\nSCREEN=0\nWINDOW=123\n")).toEqual({ x: 640, y: 400 });
    expect(() => parseCursor("nope")).toThrow();
  });

  it("builds clicks with held modifiers around the click", () => {
    expect(clickBody(10, 20, { button: "right", count: 1, modifiers: ["ctrl", "shift"] })).toBe(
      "xdotool mousemove 10 20 sleep 0.05 keydown ctrl keydown shift click --repeat 1 --delay 80 3 keyup ctrl keyup shift",
    );
    expect(() => clickBody(1.5, 2, { button: "left", count: 1, modifiers: [] })).toThrow();
    expect(scrollBody(5, 6, "down", 3)).toContain("click --repeat 3 --delay 30 5");
  });

  it("refuses anything but plain names where a shell would read them", () => {
    expect(() => keyBody(["ctrl+s; rm -rf ~"], 1)).toThrow();
    expect(keyBody(["ctrl+s", "Return"], 1)).toMatch(/-- ctrl\+s Return$/);
    expect(() => checkWindowId("0x1; reboot")).toThrow();
    expect(checkWindowId("0x02200003")).toBe("0x02200003");
    expect(() => openAppBody("$(reboot)")).toThrow();
    expect(() => desktopProfileDir("../x")).toThrow();
    expect(desktopProfileDir("bot-1")).toBe(".tiny-agents/computer-profiles/bot-1");
    expect(screenshotBody({ x: 1, y: 2, width: 30, height: 40 })).toContain("-a 1,2,30,40");
  });

  it("parses the launch report", () => {
    expect(parseDesktopLaunch("ok display=91 vnc=40123")).toEqual({
      display: 91,
      vncPort: 40123,
      reused: false,
    });
    expect(parseDesktopLaunch("ok display=91 vnc=40123 reused=1").reused).toBe(true);
    expect(() => parseDesktopLaunch("")).toThrow();
  });

  it("reads the desktop size and extra packages from the env", () => {
    expect(parseDesktopSize(undefined)).toEqual({ width: 1280, height: 800 });
    expect(parseDesktopSize("1024x768")).toEqual({ width: 1024, height: 768 });
    expect(parseDesktopSize("4000x3000")).toMatchObject({ width: 1280, invalid: "4000x3000" });
    expect(parseExtraPackages("libreoffice-calc, gimp gimp ;rm")).toEqual({
      packages: ["libreoffice-calc", "gimp"],
      invalid: [";rm"],
    });
  });

  it("installs the extra packages and checks for them before calling the stack ready", () => {
    const install = installComputerStackCommand(["libreoffice-calc"]);
    expect(install).toContain("xfce4-session");
    expect(install).toContain("xdotool");
    expect(install).toContain("libreoffice-calc");
    expect(install).toContain("browser-stack.lock");
    expect(computerStackReadyCommand(["gimp"])).toContain("gimp");
    expect(() => installComputerStackCommand(["x; reboot"])).toThrow();
  });
});
