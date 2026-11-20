type Driver = "agent" | "human";

export type BrowserProfile = "shared" | "own";

export type OpenPhase = "installing" | "starting";

interface OpenFields {
  starting: boolean;
  phase: OpenPhase | null;
  error: string | null;
}

interface ProfileFields {
  profile: string;
  label: string;
  bots: { id: string; name: string }[];
}

export interface PageBrowser extends ProfileFields, OpenFields {
  active: boolean;
  driver: Driver | null;
  mode: "vnc" | "headless" | null;
}

export interface PageBrowserList {
  liveView: boolean;
  setupHint: string | null;
  browsers: PageBrowser[];
}

export interface Desktop extends ProfileFields, OpenFields {
  active: boolean;
  driver: Driver | null;
  takeover: string | null;
}

export interface DesktopList {
  configured: boolean;
  setupHint: string | null;
  width: number | null;
  height: number | null;
  desktops: Desktop[];
}

export interface DesktopApp {
  id: string;
  name: string;
}

export interface DesktopApps {
  apps: DesktopApp[];
}

export interface BrowserStatus extends OpenFields {
  active: boolean;
  profile: BrowserProfile;
  url: string | null;
  driver: Driver | null;
  mode: "vnc" | "headless" | null;
  scale: number | null;
}

export interface ComputerStatus extends OpenFields {
  configured: boolean;
  setupHint: string | null;
  active: boolean;
  profile: BrowserProfile;
  driver: Driver | null;
  width: number | null;
  height: number | null;
  takeover: string | null;
}

export interface VncTicket {
  path: string;
  scale: number;
}

export interface LiveStarting {
  starting: true;
}

export interface DriverBody {
  driver: Driver;
}

export interface ResizeBody {
  width: number;
  height: number;
}

export interface OpenAppBody {
  id: string;
}
