import type { BrowserSessions } from "@tiny-agents/sandbox/browser";
import type { LiveComputer } from "@tiny-agents/sandbox/computer";
import { Boom } from "@groot/core/errors";
import { browserLiveViewHint, getBrowserSessions } from "../bots/browser.sessions";
import { SHARED_BROWSER_PROFILE } from "../bots/browser.targets";
import { issueBrowserPageVncTicket, issueVncTicket } from "../bots/browser.vnc";
import { computerSetupHint, getComputerSessions } from "../bots/computer.sessions";
import { issueComputerVncTicket, issueDesktopVncTicket } from "../bots/computer.vnc";
import { listProfiles } from "../bots/profiles";
import { liveRouter, OWNER_TAB, type LiveAddress, type LiveSurface } from "./live.router";
import type {
  BrowserProfile,
  BrowserStatus,
  ComputerStatus,
  DesktopList,
  OpenPhase,
  PageBrowserList,
} from "../../../shared/api/live";

type LiveBrowser = NonNullable<ReturnType<BrowserSessions["get"]>>;
type OpenState = ReturnType<BrowserSessions["openState"]>;

const profileKind = (profile: string): BrowserProfile =>
  profile === SHARED_BROWSER_PROFILE ? "shared" : "own";

function openFields(
  live: unknown,
  opening: OpenState,
): { starting: boolean; phase: OpenPhase | null; error: string | null } {
  return {
    starting: opening.opening,
    phase: opening.opening ? opening.phase : null,
    error: !live && !opening.opening ? (opening.error ?? null) : null,
  };
}

const browserMode = (live: LiveBrowser | undefined) =>
  live ? (live.session.vnc ? "vnc" : "headless") : null;

const browser: LiveSurface<LiveBrowser> = {
  name: "browser",
  ops() {
    const sessions = getBrowserSessions();
    return {
      get: (at) => sessions.get(at),
      start: (at) => sessions.start(at),
      setDriver: (at, driver) => sessions.setDriver(at, driver),
      reset: (at) => sessions.close(at, { wipeProfile: true }),
    };
  },
  view: (live) => live.session.vnc,
  noView: "This browser is headless and has no live view.",
  resetFailed: "Could not reset the browser.",
  touchOnTakeover: true,
  resize: { cannot: "This browser cannot be resized.", failed: "Could not resize the browser." },
  profiles: {
    notFound: "No such browser.",
    notRunning: "This browser is not running.",
    issueTicket: ({ userId, at }) =>
      issueBrowserPageVncTicket({ userId, profile: at.profile, target: at }),
    async list(): Promise<PageBrowserList> {
      const sessions = getBrowserSessions();
      const hint = browserLiveViewHint();
      const list = await listProfiles();
      return {
        liveView: !hint,
        setupHint: hint ?? null,
        browsers: list.map((entry) => {
          const target = { profile: entry.profile, tab: OWNER_TAB };
          const live = sessions.get(target);
          return {
            ...entry,
            active: Boolean(live),
            driver: live?.driver ?? null,
            mode: browserMode(live),
            ...openFields(live, sessions.openState(target)),
          };
        }),
      };
    },
  },
  bots: {
    notRunning: "No browser session for this bot yet.",
    issueTicket: ({ userId, scope, at, viewOnly }) =>
      issueVncTicket({ userId, botId: scope, target: at, viewOnly }),
    status(at: LiveAddress): BrowserStatus {
      const sessions = getBrowserSessions();
      const live = sessions.get(at);
      const opening = sessions.openState(at);
      return {
        active: Boolean(live),
        profile: profileKind(at.profile),
        url: live?.tabs.get(at.tab)?.url() ?? null,
        driver: live?.driver ?? null,
        mode: browserMode(live),
        scale: live?.session.vnc?.scale ?? null,
        ...openFields(live, opening),
      };
    },
    bodyBeforeBot: true,
    opensTabForTicket: true,
    noViewIsNotRunning: false,
  },
};

const computer: LiveSurface<LiveComputer> = {
  name: "computer",
  ops() {
    const sessions = getComputerSessions();
    if (!sessions) throw Boom.conflict(computerSetupHint() ?? "The computer is not configured.");
    return {
      get: (at) => sessions.get(at.profile),
      start: (at) => sessions.start(at.profile),
      setDriver: (at, driver) => sessions.setDriver(at.profile, driver),
      reset: (at) => sessions.close(at.profile, { wipe: true }),
    };
  },
  view: (live) => (live.desktop.vnc ? { scale: 1 } : undefined),
  noView: "This desktop has no live view.",
  resetFailed: "Could not reset the computer.",
  touchOnTakeover: false,
  apps: {
    list: (live) => live.desktop.listApps(),
    open: (live, id) => live.desktop.openApp(id),
    notDriving: "Take control of the desktop first.",
    listFailed: "Could not list the apps.",
    openFailed: "Could not open the app.",
  },
  profiles: {
    notFound: "No such desktop.",
    notRunning: "This desktop is not running.",
    issueTicket: ({ userId, at }) => issueDesktopVncTicket({ userId, profile: at.profile }),
    async list(): Promise<DesktopList> {
      const sessions = getComputerSessions();
      const list = await listProfiles();
      return {
        configured: Boolean(sessions),
        setupHint: sessions ? null : (computerSetupHint() ?? null),
        width: sessions?.width ?? null,
        height: sessions?.height ?? null,
        desktops: list.map((desktop) => {
          const live = sessions?.get(desktop.profile);
          return {
            ...desktop,
            active: Boolean(live),
            driver: live?.driver ?? null,
            takeover: live?.takeover?.reason ?? null,
            ...openFields(live, sessions?.openState(desktop.profile) ?? { opening: false }),
          };
        }),
      };
    },
  },
  bots: {
    notRunning: "No desktop is running for this bot yet.",
    issueTicket: ({ userId, scope, at, viewOnly }) =>
      issueComputerVncTicket({ userId, botId: scope, profile: at.profile, viewOnly }),
    status(at: LiveAddress): ComputerStatus {
      const sessions = getComputerSessions();
      const live = sessions?.get(at.profile);
      return {
        configured: Boolean(sessions),
        setupHint: sessions ? null : (computerSetupHint() ?? null),
        active: Boolean(live),
        profile: profileKind(at.profile),
        driver: live?.driver ?? null,
        width: sessions?.width ?? null,
        height: sessions?.height ?? null,
        takeover: live?.takeover?.reason ?? null,
        ...openFields(live, sessions?.openState(at.profile) ?? { opening: false }),
      };
    },
    bodyBeforeBot: false,
    opensTabForTicket: false,
    noViewIsNotRunning: true,
  },
};

export default liveRouter([browser, computer]);
