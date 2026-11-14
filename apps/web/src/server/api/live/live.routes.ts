/**
 * The two live surfaces on the profile-addressed router (`live.router.ts`):
 * the bots' browsers (issues #24, #160) and their desktops (issue #108).
 *
 * A browser is a full Chrome on the sandbox VM's virtual desktop, streamed
 * over VNC (`../bots/browser.vnc.ts`); without a VM (local dev, CI) it runs
 * headless, so the agent can use it but there is nothing to stream. A
 * desktop is an XFCE session on the VM (`../bots/computer.vnc.ts`) at a fixed
 * size the viewer scales, so it has no resize; without a sandbox there is no
 * computer at all, and its routes answer 409 with the setup hint. Bots on the
 * shared profile share one browser, each in a tab of its own, and one
 * desktop: taking control, the live view and "Reset" act on that shared one.
 * Keystrokes travel inside the VNC stream and are never logged.
 */
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

type LiveBrowser = NonNullable<ReturnType<BrowserSessions["get"]>>;
type OpenState = ReturnType<BrowserSessions["openState"]>;

/** "shared" when other bots use this browser or desktop (and its logins) too. */
const profileKind = (profile: string) => (profile === SHARED_BROWSER_PROFILE ? "shared" : "own");

/** Opening, and why the last open failed; `phase` is `installing` during the one-time VM setup. */
function openFields(live: unknown, opening: OpenState) {
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
      // On the shared profile this signs every bot that uses it out.
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
    lookupInWrapper: true,
    notRunning: "This browser is not running.",
    issueTicket: ({ userId, at }) =>
      issueBrowserPageVncTicket({ userId, profile: at.profile, target: at }),
    async list() {
      const sessions = getBrowserSessions();
      const hint = browserLiveViewHint();
      const list = await listProfiles();
      return {
        liveView: !hint,
        setupHint: hint ?? null,
        browsers: list.map((entry) => {
          // The owner's tab: opening the page never lands in a bot's tab.
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
    status(at: LiveAddress) {
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
      // Settings and app state on the VM; files in the home directory stay.
      reset: (at) => sessions.close(at.profile, { wipe: true }),
    };
  },
  view: (live) => (live.desktop.vnc ? { scale: 1 } : undefined),
  noView: "This desktop has no live view.",
  resetFailed: "Could not reset the computer.",
  // Its manager touches the desktop on every driver change itself.
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
    lookupInWrapper: false,
    notRunning: "This desktop is not running.",
    issueTicket: ({ userId, at }) => issueDesktopVncTicket({ userId, profile: at.profile }),
    async list() {
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
    status(at: LiveAddress) {
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
        // What a bot asked the owner to do (computer_request_takeover), while it waits.
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
