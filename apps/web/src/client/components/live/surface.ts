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

interface ResetCopy {
  confirm: ConfirmOptions;
  done: string;
}

interface OffCopy<Described> {
  icon: LucideIcon;
  installing: { title: string; description: string };
  starting: string;
  failed: string;
  closed: { title: string; description: Described; open: string };
}

export type PageOffCopy = OffCopy<string>;

export interface AppsApi {
  list(profile: string): Promise<DesktopApps>;
  open(profile: string, id: string): Promise<unknown>;
}

export interface PanelStatus extends LiveItem {
  profile: BrowserProfile;
  starting: boolean;
  phase: OpenPhase | null;
  error: string | null;
}

export interface PageItem extends LiveItem {
  profile: string;
  label: string;
  bots: { id: string; name: string }[];
  starting: boolean;
  phase: OpenPhase | null;
  error: string | null;
}

export interface LivePanelSurface<S extends PanelStatus> {
  title: string;
  width: {
    key: string;
    initial: number;
    cssVar: string;
    docked: string;
  };
  resizeLabel: string;
  resizeTestId?: string;
  closeLabel: string;
  api: {
    status(botId: string): Promise<S>;
    driver(botId: string, driver: Driver): Promise<unknown>;
    start(botId: string): Promise<unknown>;
    reset(botId: string): Promise<unknown>;
  };
  startFailed: string;
  resetCopy(status: S | undefined): ResetCopy;
  mode(status: S): "vnc" | "headless" | null;
  setup?: { configured(status: S): boolean; title: string; hint(status: S): string };
  headlessDetail?(status: S): { text: string; testId: string } | null;
  takeTitle(bot: string): string;
  releaseTitle(bot: string): string;
  takeover?: { done: string; note: string };
  openPage: { to(status: S | null, bot: Bot): string; label: string; forGuests: boolean };
  reset: { label: string; title(shared: boolean): string };
  connecting: string;
  headless?: { title: string; note(bot: string): ReactNode };
  off: OffCopy<(bot: string) => string>;
}

export interface LivePageSurface<L, I extends PageItem> {
  title: string;
  description: string;
  selectedKey: string;
  deepLink: boolean;
  api: {
    list(): Promise<L>;
    start(profile: string): Promise<unknown>;
    ticket(profile: string): Promise<VncTicket>;
    resize?(profile: string, size: ResizeBody): Promise<unknown>;
    driver(profile: string, driver: Driver): Promise<unknown>;
    reset(profile: string): Promise<unknown>;
  };
  items(list: L): I[];
  withItems(list: L, items: I[]): L;
  available(list: L): boolean;
  setupHint(list: L): string | null;
  unavailable: { title: string; hint: string };
  loading: string;
  loadFailed: { title: string; message: string };
  startFailed: string;
  resetCopy(item: I | undefined): ResetCopy;
  tabs: {
    label: string;
    own: string;
    errorDot: boolean;
  };
  takeTitle: string;
  takeover?: { asked: string; note: string };
  connecting: string;
  headless?: { title: string; description: string };
  off: PageOffCopy;
  reset: { label: string; title: string };
  apps?: AppsApi;
  keys?: readonly DesktopShortcut[];
}

export interface LiveSurface<S extends PanelStatus, L, I extends PageItem> {
  kind: LiveViewKind;
  fitsWindow: boolean;
  panel: LivePanelSurface<S>;
  page: LivePageSurface<L, I>;
}
