/**
 * The two live-view surfaces (`surface.ts`): the bots' browsers (issues #24,
 * #160) and their desktops (issue #108), each as the chat's panel and as its
 * page. Every field is a difference the two had when they were separate
 * components (docs/rewrite/README.md §4.5).
 */
import { Globe, Monitor } from "lucide-react";
import { monoClass } from "@groot/ui";
import type {
  BrowserStatus,
  ComputerStatus,
  Desktop,
  DesktopList,
  PageBrowser,
  PageBrowserList,
} from "../../../shared/api/live";
import { botsApi } from "../../lib/bots-api";
import { browserPageApi } from "../../lib/browser-page-api";
import { computerApi } from "../../lib/computer-api";
import { DESKTOP_SHORTCUTS } from "../../lib/desktop-keys";
import type { LiveSurface } from "./surface";

export const browserSurface: LiveSurface<BrowserStatus, PageBrowserList, PageBrowser> = {
  kind: "browser",
  fitsWindow: true,
  panel: {
    title: "Browser",
    width: {
      key: "tiny-agents:browser-panel-width",
      initial: 640,
      cssVar: "--browser-panel-width",
      docked:
        "fixed inset-0 z-40 bg-background xl:static xl:z-auto xl:h-full xl:w-[min(var(--browser-panel-width),calc(100vw-42rem))] xl:shrink-0 xl:bg-transparent xl:p-2 xl:pl-0",
    },
    resizeLabel: "Resize browser panel",
    resizeTestId: "browser-resize",
    closeLabel: "Close browser panel",
    api: {
      status: (id) => botsApi.browserStatus(id),
      driver: (id, driver) => botsApi.browserDriver(id, driver),
      start: (id) => botsApi.browserStart(id),
      reset: (id) => botsApi.browserResetProfile(id),
    },
    startFailed: "Failed to open the browser",
    // A reset of the shared profile signs every bot on it out: say so first.
    resetCopy: (status) =>
      status?.profile !== "own"
        ? {
            confirm: {
              title: "Reset the shared browser?",
              description:
                "This closes the browser that every bot on the shared profile uses and deletes its cookies and logins, so all of those bots are signed out of every site.",
              confirmLabel: "Reset",
              destructive: true,
            },
            done: "Shared browser wiped; the next session starts fresh.",
          }
        : {
            confirm: {
              title: "Reset this bot's browser?",
              description: "This closes the browser and deletes its cookies and logins.",
              confirmLabel: "Reset",
              destructive: true,
            },
            done: "Browser profile wiped; the next session starts fresh.",
          },
    mode: (status) => (status.active ? (status.mode ?? "headless") : null),
    // The streamed Chrome has its own address bar, so the bot's last URL goes
    // while the owner drives.
    detail: (status, { mode, humanDrives }) =>
      !(mode === "vnc" && humanDrives) && status.url
        ? { text: status.url, testId: "browser-url", grow: true }
        : null,
    takeTitle: (bot) => `Click and type in the browser yourself. ${bot} waits.`,
    releaseTitle: (bot) => `Hand the browser back to ${bot}`,
    // The Browser page (issue #160) is the owner's; it opens on this browser.
    openPage: {
      to: (status, bot) =>
        `/browser?profile=${encodeURIComponent(status?.profile !== "own" ? "shared" : `bot-${bot.id}`)}`,
      label: "Open in the Browser page",
      forGuests: false,
    },
    reset: {
      label: "Reset browser profile",
      title: (shared) =>
        shared
          ? "Close the shared browser and wipe its profile (every bot on it)"
          : "Close the browser and wipe its profile",
    },
    connecting: "Connecting to the browser…",
    headless: {
      title: "No live view for this browser.",
      note: (bot) => (
        <>
          {bot} is using a headless browser on this server. Point{" "}
          <span className={monoClass}>SANDBOX_HOST</span> at a VM to watch it and take control.
        </>
      ),
    },
    off: {
      icon: Globe,
      installing: {
        title: "Setting up the browser on the VM",
        description:
          "First run only: installing Chrome and the display server. This takes a few minutes.",
      },
      starting: "Starting the browser",
      failed: "Couldn't open the browser",
      closed: {
        title: "No browser is open.",
        description: (bot) => `The browser also opens when ${bot} first uses it.`,
        open: "Open browser",
      },
    },
  },
  page: {
    title: "Browser",
    description:
      "The bots' browsers on the sandbox VM. Take control to use one yourself; bots on it wait.",
    selectedKey: "tiny-agents:browser-page-profile",
    deepLink: true,
    api: browserPageApi,
    items: (list) => list.browsers,
    withItems: (list, browsers) => ({ ...list, browsers }),
    available: (list) => list.liveView,
    setupHint: (list) => list.setupHint,
    unavailable: {
      title: "No live browser on this server",
      hint: "The browser runs headless here.",
    },
    loading: "Loading browsers…",
    loadFailed: { title: "Couldn't load the browsers", message: "Failed to load the browsers" },
    startFailed: "Failed to open the browser",
    resetCopy: (b) => {
      const others = b?.bots.map((bot) => bot.name) ?? [];
      return {
        confirm: {
          title: `Reset the ${b?.label ?? "Shared"} browser?`,
          description:
            "This closes the browser and deletes its profile: cookies, logins and history" +
            (b?.profile === "shared" && others.length > 0
              ? `. Every bot on it is signed out (${others.join(", ")}).`
              : "."),
          confirmLabel: "Reset",
          destructive: true,
        },
        done: "Browser reset; it starts fresh next time.",
      };
    },
    tabs: { label: "Browsers", own: "own browser", errorDot: true },
    statusLine: true,
    connecting: "Connecting to the browser…",
    headless: {
      title: "This browser is headless",
      description: "Bots can use it, but it has no display to show.",
    },
    off: {
      icon: Globe,
      installing: {
        title: "Installing Chrome on the VM",
        description:
          "First run only: installing the browser and its display. This takes a few minutes.",
      },
      starting: "Starting the browser",
      failed: "Couldn't start the browser",
      closed: {
        title: "This browser is closed.",
        description: "It also opens when a bot that uses it browses.",
        open: "Open browser",
      },
    },
    reset: { label: "Reset browser", title: "Close this browser and wipe its profile" },
  },
};

export const computerSurface: LiveSurface<ComputerStatus, DesktopList, Desktop> = {
  kind: "computer",
  fitsWindow: false,
  panel: {
    title: "Computer",
    width: {
      key: "tiny-agents:computer-panel-width",
      initial: 720,
      cssVar: "--computer-panel-width",
      docked:
        "fixed inset-0 z-40 bg-background xl:static xl:z-auto xl:h-full xl:w-[min(var(--computer-panel-width),calc(100vw-42rem))] xl:shrink-0 xl:bg-transparent xl:p-2 xl:pl-0",
    },
    resizeLabel: "Resize computer panel",
    closeLabel: "Close computer panel",
    api: {
      status: (id) => botsApi.computerStatus(id),
      driver: (id, driver) => botsApi.computerDriver(id, driver),
      start: (id) => botsApi.computerStart(id),
      reset: (id) => botsApi.computerReset(id),
    },
    startFailed: "Failed to open the computer",
    resetCopy: (status) => {
      const shared = status?.profile !== "own";
      return {
        confirm: {
          title: shared ? "Reset the shared computer?" : "Reset this bot's computer?",
          description: shared
            ? "This closes the desktop every bot on the shared profile uses and deletes its settings and app state. Files in the home folder stay."
            : "This closes the desktop and deletes its settings and app state. Files in the home folder stay.",
          confirmLabel: "Reset",
          destructive: true,
        },
        done: "Computer reset; the next session starts a fresh desktop.",
      };
    },
    mode: (status) => (status.active ? "vnc" : null),
    setup: {
      configured: (status) => status.configured,
      title: "No computer on this server.",
      hint: (status) => status.setupHint ?? "The computer is not configured.",
    },
    detail: (status) =>
      status.width && status.height ? { text: `${status.width}×${status.height}` } : null,
    takeTitle: (bot) => `Click and type on the computer yourself. ${bot} waits and sees nothing.`,
    releaseTitle: (bot) => `Hand the computer back to ${bot}`,
    takeover: { done: "I'm done", note: "It sees nothing until you press I'm done." },
    openPage: { to: () => "/computer", label: "Open the Computer page", forGuests: true },
    reset: {
      label: "Reset computer",
      title: (shared) =>
        shared
          ? "Close the shared desktop and wipe its settings (every bot on it)"
          : "Close the desktop and wipe its settings",
    },
    connecting: "Connecting to the computer…",
    off: {
      icon: Monitor,
      installing: {
        title: "Setting up the computer on the VM",
        description:
          "First run only: installing the desktop and its tools. This takes a few minutes.",
      },
      starting: "Starting the computer",
      failed: "Couldn't open the computer",
      closed: {
        title: "The computer is off.",
        description: (bot) => `It also starts when ${bot} first uses it.`,
        open: "Open computer",
      },
    },
  },
  page: {
    title: "Computer",
    description:
      "The bots' desktops on the sandbox VM. Take control to use one yourself; bots on it wait.",
    selectedKey: "tiny-agents:computer-desktop",
    deepLink: false,
    api: computerApi,
    items: (list) => list.desktops,
    withItems: (list, desktops) => ({ ...list, desktops }),
    available: (list) => list.configured,
    setupHint: (list) => list.setupHint,
    unavailable: { title: "No computer on this server", hint: "The computer is not configured." },
    loading: "Loading desktops…",
    loadFailed: { title: "Couldn't load the computer", message: "Failed to load the desktops" },
    startFailed: "Failed to start the desktop",
    resetCopy: (d) => ({
      confirm: {
        title: `Reset the ${d?.label ?? "Shared"} desktop?`,
        description:
          "This closes the desktop and deletes its settings and app state on the VM" +
          ((d?.bots.length ?? 0) > 1 ? ", for every bot that uses it" : "") +
          ". Files in the home folder stay.",
        confirmLabel: "Reset",
        destructive: true,
      },
      done: "Desktop reset; it starts fresh next time.",
    }),
    tabs: { label: "Desktops", own: "own desktop", errorDot: false },
    statusLine: false,
    takeover: { asked: "A bot asked you:", note: "It sees nothing until you release control." },
    connecting: "Connecting to the desktop…",
    off: {
      icon: Monitor,
      installing: {
        title: "Setting up the computer on the VM",
        description:
          "First run only: installing the desktop and its tools. This takes a few minutes.",
      },
      starting: "Starting the desktop",
      failed: "Couldn't start the desktop",
      closed: {
        title: "This desktop is off.",
        description: "It also starts when a bot that uses it first needs the computer.",
        open: "Start desktop",
      },
    },
    reset: { label: "Reset desktop", title: "Close this desktop and wipe its settings" },
    apps: {
      list: (profile) => computerApi.apps(profile),
      open: (profile, id) => computerApi.openApp(profile, id),
    },
    keys: DESKTOP_SHORTCUTS,
  },
};
