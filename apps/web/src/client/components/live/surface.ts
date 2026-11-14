/**
 * A live-view surface on the client: the Browser or the Computer, as the
 * chat's panel (`LivePanel`) and as its page (`LivePage`). Both render either
 * surface; every difference between the two is a field here, the way the
 * server's `LiveSurface` (`server/api/live/live.router.ts`) holds every
 * difference between its two routers. `surfaces.tsx` has the two, and
 * docs/rewrite/README.md §4.5 tables each field.
 *
 * What both share stays in `lib/live-view.ts` (the poll and its cadence, the
 * driver switch, open and reset, full screen, the connection label, the
 * panel width) and in `VncView`; those already key their few differences
 * (the locked keys, the reset's settled status, the viewer's fit) by `kind`.
 */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { ConfirmOptions } from "@groot/ui/primitives";
import type { Bot } from "../../../shared/api/bots";
import type {
  BrowserProfile,
  DesktopApps,
  OpenPhase,
  ResizeBody,
  VncTicket,
} from "../../../shared/api/live";
import type { DesktopShortcut } from "../../lib/desktop-keys";
import type { Driver, LiveItem, LiveViewKind } from "../../lib/live-view";

/** A reset's confirm dialog, and its toast once done. */
interface ResetCopy {
  confirm: ConfirmOptions;
  done: string;
}

/** What the view shows while there is nothing to stream: opening, first-run setup, failed, closed. */
interface OffCopy<Described> {
  icon: LucideIcon;
  /** The one-time VM setup (`phase: "installing"`). */
  installing: { title: string; description: string };
  /** The title while opening; the description is "This takes a few seconds." */
  starting: string;
  /** The title when the last open failed (its error below, then Try again). */
  failed: string;
  closed: { title: string; description: Described; open: string };
}

/** The page's copy for one that is not live. */
export type PageOffCopy = OffCopy<string>;

/** The desktop's apps, by profile (the Computer page's Apps menu). */
export interface AppsApi {
  list(profile: string): Promise<DesktopApps>;
  open(profile: string, id: string): Promise<unknown>;
}

/** One bot's status, as the chat's panel polls it. */
export interface PanelStatus extends LiveItem {
  profile: BrowserProfile;
  starting: boolean;
  phase: OpenPhase | null;
  error: string | null;
}

/** One browser or desktop on the page. */
export interface PageItem extends LiveItem {
  /** `shared`, or `bot-<id>` for a bot with a profile of its own. */
  profile: string;
  label: string;
  bots: { id: string; name: string }[];
  starting: boolean;
  phase: OpenPhase | null;
  error: string | null;
}

/** The chat's panel: one bot's browser or desktop, beside the conversation. */
interface LivePanelSurface<S extends PanelStatus> {
  /** The card's title (the live view's tabs replace it when the chat has both). */
  title: string;
  width: {
    /** Where the dragged width is remembered. */
    key: string;
    initial: number;
    /** The CSS variable the docked class reads the width from. */
    cssVar: string;
    /** The docked panel's classes, written out so Tailwind finds the variable. */
    docked: string;
  };
  resizeLabel: string;
  /** The resize handle's test id (the browser's only). */
  resizeTestId?: string;
  closeLabel: string;
  api: {
    status(botId: string): Promise<S>;
    driver(botId: string, driver: Driver): Promise<unknown>;
    start(botId: string): Promise<unknown>;
    reset(botId: string): Promise<unknown>;
  };
  /** The toast when opening fails. */
  startFailed: string;
  resetCopy(status: S | undefined): ResetCopy;
  /** `vnc` streams; `headless` is open without a display; null while closed. */
  mode(status: S): "vnc" | "headless" | null;
  /**
   * Whether this server can have one at all (the computer's `configured`);
   * without it the panel is always set up, even before the first status.
   */
  setup?: { configured(status: S): boolean; title: string; hint(status: S): string };
  /** The status line's last part, after who drives: the browser's URL, the desktop's size. */
  detail(
    status: S,
    view: { mode: "vnc" | "headless"; humanDrives: boolean },
  ): { text: string; testId?: string; grow?: boolean } | null;
  takeTitle(bot: string): string;
  releaseTitle(bot: string): string;
  /** A bot asks the owner to take over (the computer's): the banner, and the hand-back's label. */
  takeover?: { done: string; note: string };
  /** The link to the page, from the header. */
  openPage: { to(status: S | null, bot: Bot): string; label: string; forGuests: boolean };
  reset: { label: string; title(shared: boolean): string };
  connecting: string;
  /** What a headless one says (the browser's). */
  headless?: { title: string; note(bot: string): ReactNode };
  off: OffCopy<(bot: string) => string>;
}

/** The page: every browser or desktop on the VM, a tab each. */
interface LivePageSurface<L, I extends PageItem> {
  title: string;
  description: string;
  /** Where the selected tab is remembered. */
  selectedKey: string;
  /** Whether `?profile=` picks the tab (the chat's Browser panel links there). */
  deepLink: boolean;
  api: {
    list(): Promise<L>;
    start(profile: string): Promise<unknown>;
    ticket(profile: string): Promise<VncTicket>;
    /** Fits the remote window to the viewer (the browser's); without it the viewer only scales. */
    resize?(profile: string, size: ResizeBody): Promise<unknown>;
    driver(profile: string, driver: Driver): Promise<unknown>;
    reset(profile: string): Promise<unknown>;
  };
  items(list: L): I[];
  withItems(list: L, items: I[]): L;
  /** Whether this server has a live view to show (`liveView`, `configured`). */
  available(list: L): boolean;
  setupHint(list: L): string | null;
  unavailable: { title: string; hint: string };
  loading: string;
  loadFailed: { title: string; message: string };
  startFailed: string;
  resetCopy(item: I | undefined): ResetCopy;
  tabs: {
    label: string;
    /** Who uses a bot's own one, in its tab. */
    own: string;
    /** Whether a failed open turns the tab's dot red. */
    errorDot: boolean;
  };
  /** The connection and who drives, over the view (the browser's). */
  statusLine: boolean;
  /** A bot asks the owner to take over (the computer's): a hand on its tab, the banner while driving. */
  takeover?: { asked: string; note: string };
  connecting: string;
  headless?: { title: string; description: string };
  off: PageOffCopy;
  reset: { label: string; title: string };
  /** The Apps menu (the computer's). */
  apps?: AppsApi;
  /** The Keys menu's shortcuts (the computer's). */
  keys?: readonly DesktopShortcut[];
}

export interface LiveSurface<S extends PanelStatus, L, I extends PageItem> {
  /**
   * `browser` or `computer`: the test ids (`<kind>-…`), and in
   * `lib/live-view.ts` and `VncView` the keys full screen locks, the status a
   * reset leaves, what streams, and how the viewer sizes the remote side.
   */
  kind: LiveViewKind;
  /**
   * Whether the viewer fits the remote window to its box (the browser's
   * resize route), so a guest's panel must ask it to keep its size (S2).
   */
  fitsWindow: boolean;
  panel: LivePanelSurface<S>;
  page: LivePageSurface<L, I>;
}
