/**
 * The live views' wire types (`server/api/live`): the bots' browsers (issues
 * #24, #160) and desktops (issue #108), by profile for the Browser and
 * Computer pages and by bot for the chat's panels. Naming in `./common.ts`.
 */

type Driver = "agent" | "human";

/** `shared`: the browser (and logins) every such bot uses; `own`: one of its own. */
export type BrowserProfile = "shared" | "own";

/** `installing` is the one-time VM setup. */
export type OpenPhase = "installing" | "starting";

/** Opening, and why the last open failed (until the next attempt). */
interface OpenFields {
  starting: boolean;
  phase: OpenPhase | null;
  error: string | null;
}

/** A browser or desktop on the pages: which profile, and who uses it. */
interface ProfileFields {
  /** `shared`, or `bot-<id>` for a bot with a profile of its own. */
  profile: string;
  /** "Shared", or the name of the bot with a profile of its own. */
  label: string;
  bots: { id: string; name: string }[];
}

/** One browser on the Browser page. */
export interface PageBrowser extends ProfileFields, OpenFields {
  active: boolean;
  driver: Driver | null;
  /** `vnc` streams; `headless` runs without a display. Null while closed. */
  mode: "vnc" | "headless" | null;
}

/** `GET /browser`. */
export interface PageBrowserList {
  /** False when this server's browsers run headless (no sandbox VM). */
  liveView: boolean;
  setupHint: string | null;
  browsers: PageBrowser[];
}

/** One desktop on the Computer page. */
export interface Desktop extends ProfileFields, OpenFields {
  active: boolean;
  driver: Driver | null;
  /** What a bot asked the owner to do, while it waits for a hand-back. */
  takeover: string | null;
}

/** `GET /computer`. */
export interface DesktopList {
  configured: boolean;
  setupHint: string | null;
  width: number | null;
  height: number | null;
  desktops: Desktop[];
}

/** An app the desktop can open. */
export interface DesktopApp {
  /** Desktop entry id without `.desktop` ("org.xfce.mousepad"). */
  id: string;
  name: string;
}

/** `GET /computer/:profile/apps`. */
export interface DesktopApps {
  apps: DesktopApp[];
}

/** `GET /bots/:id/browser`: the bot's browser session (issue #24). */
export interface BrowserStatus extends OpenFields {
  active: boolean;
  /** Whether the bot uses the shared browser (other bots too) or its own. */
  profile: BrowserProfile;
  /** The bot's own tab; null until it has one. */
  url: string | null;
  driver: Driver | null;
  /** `vnc`: a streamed desktop with a full Chrome UI; `headless`: usable by the bot, no live view. */
  mode: "vnc" | "headless" | null;
  /** Pixel density of the VNC desktop. */
  scale: number | null;
}

/** `GET /bots/:id/computer`: the bot's computer, an XFCE desktop on the sandbox VM. */
export interface ComputerStatus extends OpenFields {
  /** False without a sandbox VM; `setupHint` says what to set. */
  configured: boolean;
  setupHint: string | null;
  active: boolean;
  /** Whether the bot shares the desktop with other bots or has its own. */
  profile: BrowserProfile;
  driver: Driver | null;
  /** The desktop's fixed size, which the viewer scales. */
  width: number | null;
  height: number | null;
  /** What the bot asked the owner to do while it waits for a hand-back. */
  takeover: string | null;
}

/** A one-time viewer ticket: a same-origin WebSocket path and its pixel density. */
export interface VncTicket {
  path: string;
  scale: number;
}

/** `POST …/start`: opening in the background. */
export interface LiveStarting {
  starting: true;
}

/** `POST …/driver`. */
export interface DriverBody {
  driver: Driver;
}

/** `POST …/resize`: fit the remote window to the viewer. */
export interface ResizeBody {
  width: number;
  height: number;
}

/** `POST /computer/:profile/apps`. */
export interface OpenAppBody {
  id: string;
}
