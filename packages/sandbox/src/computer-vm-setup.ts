/**
 * The computer's stack on the sandbox VM (issue #108), one `VmStack`
 * (`vm-stack.ts`): an XFCE desktop, one per profile, on a private X display
 * that Xtigervnc serves over RFB, beside (not inside) the browser's display.
 * The builders are pure strings so the scripts can be unit-tested without a
 * VM; `computer-x11.ts` runs them over SSH.
 *
 * The rules are every stack's, the browser's (`browser-vm-setup.ts`) too:
 * - the VNC port binds to 127.0.0.1 on the VM and is reached only through an
 *   SSH channel the app opens, so nothing new is reachable from the network;
 * - launches share the browser's VM-wide launch lock, so a browser and a
 *   desktop starting at once never pick the same display or port, and every
 *   process that outlives the script closes the lock's fd (`8>&-`);
 * - installs share the browser's install lock, so the two never run apt at
 *   the same time.
 *
 * Unlike the browser, a desktop survives the app: its display, port and
 * session environment are recorded in the profile directory, and the next
 * launch for the profile reattaches to it instead of starting another.
 */
import { shQuote } from "./shell";
import {
  createVmStack,
  installScript,
  launchBudgetMs,
  launchScript,
  parseReport,
  readyScript,
  RELEASE_LOCK,
  reportLine,
  teardownScript,
  type VmRun,
  type VmStack,
  type VmStackSpec,
  wipeScript,
  X_WAIT_SECONDS,
} from "./vm-stack";

/** Bump when the install steps change so existing VMs re-run them. */
export const COMPUTER_STACK_VERSION = "v1";

/** Where a profile's desktop lives on the VM, relative to the SSH user's home. */
export const COMPUTER_PROFILES_DIR = ".tiny-agents/computer-profiles";

/** The Debian/Ubuntu packages of the desktop stack. */
export const COMPUTER_PACKAGES = [
  "tigervnc-standalone-server",
  "tigervnc-common",
  "tigervnc-tools",
  "xfce4-session",
  "xfwm4",
  "xfce4-panel",
  "xfdesktop4",
  "xfce4-settings",
  "xfconf",
  "thunar",
  "xfce4-terminal",
  "mousepad",
  "xdotool",
  "scrot",
  "xclip",
  "wmctrl",
  "dbus-x11",
  "xdg-utils",
  "libgtk-3-bin",
  "python3",
  "fonts-dejavu-core",
  "fonts-liberation",
  "fonts-noto-color-emoji",
] as const;

/** Binaries the toolkit calls; all must exist for the stack to count as installed. */
const REQUIRED_COMMANDS = [
  "Xtigervnc",
  "xfce4-session",
  "xfwm4",
  "xdotool",
  "scrot",
  "xclip",
  "wmctrl",
  "dbus-launch",
];

const PACKAGE_NAME = /^[a-z0-9][a-z0-9+.-]{0,62}$/;

/**
 * `COMPUTER_EXTRA_PACKAGES` as a list ("libreoffice-calc, gimp"): names that
 * are not Debian package names are reported, never passed to a shell.
 */
export function parseExtraPackages(raw: string | undefined): {
  packages: string[];
  invalid: string[];
} {
  const packages = new Set<string>();
  const invalid: string[] = [];
  for (const entry of (raw ?? "").split(/[\s,]+/)) {
    const name = entry.trim();
    if (!name) continue;
    if (PACKAGE_NAME.test(name)) packages.add(name);
    else invalid.push(name);
  }
  return { packages: [...packages], invalid };
}

/** Desktop geometry: `COMPUTER_DESKTOP_SIZE` ("1280x800"), bounded to sizes a model reads well. */
export function parseDesktopSize(raw: string | undefined): {
  width: number;
  height: number;
  invalid?: string;
} {
  const fallback = { width: 1280, height: 800 };
  const value = raw?.trim();
  if (!value) return fallback;
  const match = /^(\d{3,4})x(\d{3,4})$/.exec(value);
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  if (!match || width < 640 || height < 480 || width > 1920 || height > 1200) {
    return { ...fallback, invalid: value };
  }
  return { width, height };
}

export interface LaunchDesktopOptions {
  /** The profile's directory on the VM (settings, pids, the session env). */
  profileDir: string;
  width: number;
  height: number;
  /**
   * The browser profile's Chrome user-data-dir on the VM (the browser
   * toolkit's, for the same profile key). Set, the desktop's Chrome opens
   * that profile, so the browser and the computer share one set of logins.
   */
  browserProfileDir?: string;
}

export interface LaunchedDesktop {
  display: number;
  vncPort: number;
  /** The desktop was already running and was reattached, not started. */
  reused: boolean;
}

/** Pids of the desktop's process groups (Xtigervnc, vncconfig, the session, dbus). */
export const DESKTOP_PID_FILE = ".desktop-pids";
/** `display=<n> vnc=<port> size=<w>x<h>` of the running desktop. */
const DESKTOP_STATE_FILE = ".desktop";
/** Shell exports every tool exec sources: DISPLAY, the XDG dirs, the session bus. */
export const DESKTOP_ENV_FILE = ".desktop-env";

const WM_WAIT_SECONDS = 30;

/**
 * XFCE settings seeded into a fresh profile: one bottom panel (menu, window
 * list, clock), no compositor, one workspace, and no screen saver, lock or
 * power manager. Without a panel config XFCE greets a new session with a
 * first-run dialog that would sit on top of the bot's first screenshot.
 */
const XFCE_SEED: Record<string, string> = {
  "xfce4-panel.xml": `<?xml version="1.0" encoding="UTF-8"?>
<channel name="xfce4-panel" version="1.0">
  <property name="configver" type="int" value="2"/>
  <property name="panels" type="array">
    <value type="int" value="1"/>
    <property name="dark-mode" type="bool" value="false"/>
    <property name="panel-1" type="empty">
      <property name="position" type="string" value="p=8;x=0;y=0"/>
      <property name="length" type="uint" value="100"/>
      <property name="position-locked" type="bool" value="true"/>
      <property name="size" type="uint" value="30"/>
      <property name="plugin-ids" type="array">
        <value type="int" value="1"/>
        <value type="int" value="2"/>
        <value type="int" value="3"/>
        <value type="int" value="4"/>
      </property>
    </property>
  </property>
  <property name="plugins" type="empty">
    <property name="plugin-1" type="string" value="applicationsmenu"/>
    <property name="plugin-2" type="string" value="tasklist"/>
    <property name="plugin-3" type="string" value="separator">
      <property name="expand" type="bool" value="true"/>
      <property name="style" type="uint" value="0"/>
    </property>
    <property name="plugin-4" type="string" value="clock"/>
  </property>
</channel>
`,
  "xfwm4.xml": `<?xml version="1.0" encoding="UTF-8"?>
<channel name="xfwm4" version="1.0">
  <property name="general" type="empty">
    <property name="use_compositing" type="bool" value="false"/>
    <property name="workspace_count" type="int" value="1"/>
  </property>
</channel>
`,
  "xfce4-session.xml": `<?xml version="1.0" encoding="UTF-8"?>
<channel name="xfce4-session" version="1.0">
  <property name="general" type="empty">
    <property name="SaveOnExit" type="bool" value="false"/>
    <property name="PromptOnLogout" type="bool" value="false"/>
  </property>
  <property name="startup" type="empty">
    <property name="screensaver" type="empty">
      <property name="enabled" type="bool" value="false"/>
    </property>
  </property>
</channel>
`,
  "xfce4-screensaver.xml": `<?xml version="1.0" encoding="UTF-8"?>
<channel name="xfce4-screensaver" version="1.0">
  <property name="saver" type="empty">
    <property name="enabled" type="bool" value="false"/>
    <property name="mode" type="int" value="0"/>
  </property>
  <property name="lock" type="empty">
    <property name="enabled" type="bool" value="false"/>
  </property>
</channel>
`,
  "xfce4-power-manager.xml": `<?xml version="1.0" encoding="UTF-8"?>
<channel name="xfce4-power-manager" version="1.0">
  <property name="xfce4-power-manager" type="empty">
    <property name="dpms-enabled" type="bool" value="false"/>
    <property name="blank-on-ac" type="int" value="0"/>
    <property name="lock-screen-suspend-hibernate" type="bool" value="false"/>
  </property>
</channel>
`,
};

/** Desktop entries XFCE autostarts that a bot's desktop must not run. */
const AUTOSTART_OFF = ["xfce4-power-manager", "xscreensaver", "xfce4-screensaver", "light-locker"];

function seedLines(): string[] {
  const dir = '"$CONF/xfce4/xfconf/xfce-perchannel-xml"';
  const lines = [`mkdir -p ${dir} "$CONF/autostart"`];
  for (const [file, xml] of Object.entries(XFCE_SEED)) {
    lines.push(
      `[ -f ${dir}/${file} ] || cat > ${dir}/${file} <<'TA_XFCE_EOF'`,
      xml.trimEnd(),
      "TA_XFCE_EOF",
    );
  }
  for (const name of AUTOSTART_OFF) {
    lines.push(
      `[ -f "$CONF/autostart/${name}.desktop" ] || printf '[Desktop Entry]\\nHidden=true\\n' > "$CONF/autostart/${name}.desktop"`,
    );
  }
  return lines;
}

/** The browser pid file (`browser-vm-setup.ts`) a desktop Chrome reads to take the profile over. */
const BROWSER_PID_FILE = ".stack-pids";

/**
 * The desktop's Chrome, installed as `$PROFILE/bin/google-chrome-stable`
 * (and `google-chrome`, `chromium` beside it): Chrome on the browser's
 * profile. Chrome locks a profile to one running instance on one display, so
 * the browser toolkit's Chrome on it, if any, is stopped first (the bot's
 * next browser call reopens it there and closes this one the same way).
 * Same `--password-store` as the browser's launch, or Chrome could not read
 * the cookies the other one saved.
 */
const DESKTOP_CHROME = `#!/bin/sh
HERE="$(cd "$(dirname "$0")/.." && pwd)"
B="$(cat "$HERE/browser-profile")"
mkdir -p "$B"
if [ -s "$B/${BROWSER_PID_FILE}" ]; then
  PIDS="$(cat "$B/${BROWSER_PID_FILE}")"
  rm -f "$B/${BROWSER_PID_FILE}"
  kill $PIDS 2>/dev/null || true
  for _ in $(seq 50); do
    ALIVE=""
    for P in $PIDS; do kill -0 "$P" 2>/dev/null && ALIVE=1; done
    [ -z "$ALIVE" ] && break
    sleep 0.2
  done
fi
for C in /usr/bin/google-chrome-stable /usr/bin/google-chrome /usr/bin/chromium; do
  [ -x "$C" ] && exec "$C" --user-data-dir="$B" --no-first-run --no-default-browser-check --password-store=basic "$@"
done
echo "Chrome is not installed on the VM" >&2
exit 1`;

/** System Chrome launchers the desktop's menu and `gtk-launch` would otherwise run. */
const CHROME_DESKTOP_ENTRIES = [
  "google-chrome.desktop",
  "chromium.desktop",
  "chromium-browser.desktop",
];

/**
 * Point the desktop's Chrome at the browser profile: the wrapper above, on
 * the session's PATH (the XFCE "Web Browser" helper), and a copy of each
 * installed Chrome menu entry in the desktop's own XDG data dir that runs it.
 * Without a browser profile, remove them so Chrome keeps its own.
 */
function browserLinkLines(browserProfileDir: string | undefined): string[] {
  const entries = CHROME_DESKTOP_ENTRIES.join(" ");
  if (!browserProfileDir) {
    return [
      'rm -rf "$PROFILE/bin" "$PROFILE/browser-profile"',
      `for F in ${entries}; do rm -f "$PROFILE/data/applications/$F"; done`,
    ];
  }
  return [
    `BROWSER_PROFILE=${shQuote(browserProfileDir)}`,
    'mkdir -p "$BROWSER_PROFILE" "$PROFILE/bin" "$PROFILE/data/applications"',
    'BROWSER_PROFILE="$(cd "$BROWSER_PROFILE" && pwd)"',
    'printf \'%s\\n\' "$BROWSER_PROFILE" > "$PROFILE/browser-profile"',
    `cat > "$PROFILE/bin/google-chrome-stable" <<'TA_CHROME_EOF'`,
    DESKTOP_CHROME,
    "TA_CHROME_EOF",
    'chmod 755 "$PROFILE/bin/google-chrome-stable"',
    'for N in google-chrome chromium chromium-browser; do ln -sf google-chrome-stable "$PROFILE/bin/$N"; done',
    `for F in ${entries}; do`,
    '  if [ -f "/usr/share/applications/$F" ]; then',
    '    sed -E "s#^(Exec|TryExec)=[^ ]+#\\1=$PROFILE/bin/google-chrome-stable#" "/usr/share/applications/$F" > "$PROFILE/data/applications/$F"',
    "  fi",
    "done",
  ];
}

/** Kill every process group recorded for the profile, then the pids themselves. */
const KILL_RECORDED = [
  `if [ -s "$PROFILE/${DESKTOP_PID_FILE}" ]; then`,
  `  for P in $(cat "$PROFILE/${DESKTOP_PID_FILE}"); do kill -- "-$P" 2>/dev/null || true; kill "$P" 2>/dev/null || true; done`,
  "fi",
  `rm -f "$PROFILE/${DESKTOP_PID_FILE}" "$PROFILE/${DESKTOP_STATE_FILE}" "$PROFILE/${DESKTOP_ENV_FILE}"`,
];

/** Desktop geometry of a launch. */
const sizeOf = (options: LaunchDesktopOptions) =>
  `${Math.round(options.width)}x${Math.round(options.height)}`;

/**
 * The desktop stack plus the owner's extra packages. The install waits out a
 * dpkg lock held by unattended upgrades.
 */
function computerStack(extraPackages: readonly string[]): VmStackSpec<LaunchDesktopOptions> {
  return {
    marker: `computer-stack-${COMPUTER_STACK_VERSION}`,
    commands: REQUIRED_COMMANDS,
    packages: extraPackages,
    readyLayout: "variable",
    installSteps: () => {
      for (const name of extraPackages) {
        if (!PACKAGE_NAME.test(name)) throw new Error(`Not a package name: ${name}`);
      }
      const packages = [...COMPUTER_PACKAGES, ...extraPackages].join(" ");
      return [
        "export DEBIAN_FRONTEND=noninteractive",
        "sudo -n apt-get -o DPkg::Lock::Timeout=180 update -qq",
        `sudo -n apt-get -o DPkg::Lock::Timeout=180 install -y -qq --no-install-recommends ${packages}`,
      ];
    },
    launch: {
      // Before the reattach check, so a running desktop's menu follows too.
      beforeLock: (options) => browserLinkLines(options.browserProfileDir),
      lockHolders: "browser or desktop",
      clearPrevious: (options) => [
        // Reattach: the desktop this profile recorded is still up at this size.
        `if [ -s "$PROFILE/${DESKTOP_STATE_FILE}" ] && [ -s "$PROFILE/${DESKTOP_ENV_FILE}" ]; then`,
        `  OLD_DISP="$(sed -n 's/.*display=\\([0-9]*\\).*/\\1/p' "$PROFILE/${DESKTOP_STATE_FILE}")"`,
        `  OLD_VNC="$(sed -n 's/.*vnc=\\([0-9]*\\).*/\\1/p' "$PROFILE/${DESKTOP_STATE_FILE}")"`,
        `  OLD_SIZE="$(sed -n 's/.*size=\\([0-9x]*\\).*/\\1/p' "$PROFILE/${DESKTOP_STATE_FILE}")"`,
        `  OLD_X="$(head -n 1 "$PROFILE/${DESKTOP_PID_FILE}" 2>/dev/null || true)"`,
        `  if [ -n "$OLD_DISP" ] && [ -n "$OLD_VNC" ] && [ "$OLD_SIZE" = "${sizeOf(options)}" ] && [ -n "$OLD_X" ] && kill -0 "$OLD_X" 2>/dev/null && [ -S "/tmp/.X11-unix/X$OLD_DISP" ] && DISPLAY=":$OLD_DISP" wmctrl -m >/dev/null 2>&1; then`,
        `    ${reportLine({ display: "OLD_DISP", vnc: "OLD_VNC" }, ["reused"])}`,
        "    exit 0",
        "  fi",
        "fi",
        // Whatever was recorded is stale (or at another size): stop it first.
        ...KILL_RECORDED,
      ],
      ports: [
        `VNC="$(python3 -c 'import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()')"`,
      ],
      prepare: () => [
        'CONF="$PROFILE/config"',
        ...seedLines(),
        'mkdir -p "$PROFILE/cache" "$PROFILE/data"',
        'XLOG="$PROFILE/.xvnc.log"',
        'SLOG="$PROFILE/.session.log"',
        'stop_started() { for P in $(cat "$PROFILE/' +
          DESKTOP_PID_FILE +
          '" 2>/dev/null); do kill -- "-$P" 2>/dev/null || true; kill "$P" 2>/dev/null || true; done; rm -f "$PROFILE/' +
          DESKTOP_PID_FILE +
          '"; }',
      ],
      geometry: sizeOf,
      desktopName: "tiny-agents-computer",
      pidFile: DESKTOP_PID_FILE,
      // Unlike the browser, give up here when the display server never came up.
      afterX: [
        'if [ ! -S "/tmp/.X11-unix/X$DISP" ]; then',
        `  echo "The display server did not start on the VM within ${X_WAIT_SECONDS}s" >&2`,
        '  tail -n 20 "$XLOG" >&2 || true',
        "  stop_started",
        "  exit 1",
        "fi",
      ],
      start: () => [
        // The session bus every app of this desktop shares; its address goes in
        // the env file tool execs source.
        `BUS="$(DISPLAY=":$DISP" dbus-launch --sh-syntax ${RELEASE_LOCK})"`,
        'eval "$BUS"',
        '[ -n "${DBUS_SESSION_BUS_PID:-}" ] && echo "$DBUS_SESSION_BUS_PID" >> "$PROFILE/' +
          DESKTOP_PID_FILE +
          '"',
        `cat > "$PROFILE/${DESKTOP_ENV_FILE}" <<TA_ENV_EOF`,
        'export DISPLAY=":$DISP"',
        'export XDG_CONFIG_HOME="$CONF"',
        'export XDG_CACHE_HOME="$PROFILE/cache"',
        'export XDG_DATA_HOME="$PROFILE/data"',
        'export PATH="$PROFILE/bin:\\$PATH"',
        "export DBUS_SESSION_BUS_ADDRESS='${DBUS_SESSION_BUS_ADDRESS:-}'",
        "TA_ENV_EOF",
        `( . "$PROFILE/${DESKTOP_ENV_FILE}" && exec setsid nohup xfce4-session </dev/null >"$SLOG" 2>&1 ${RELEASE_LOCK} ) &`,
        `echo "$!" >> "$PROFILE/${DESKTOP_PID_FILE}"`,
      ],
      up: {
        probe: 'DISPLAY=":$DISP" wmctrl -m >/dev/null 2>&1',
        seconds: WM_WAIT_SECONDS,
        deadline: "WMWAIT",
        failure: `The desktop did not start on the VM within ${WM_WAIT_SECONDS}s`,
        logs: '"$XLOG" "$SLOG"',
        cleanup: ["stop_started", `rm -f "$PROFILE/${DESKTOP_ENV_FILE}"`],
      },
      afterUp: (options) => [
        `echo "display=$DISP vnc=$VNC size=${sizeOf(options)}" > "$PROFILE/${DESKTOP_STATE_FILE}"`,
      ],
      otherWaitSeconds: 0,
    },
    report: {
      variables: { display: "DISP", vnc: "VNC" },
      flags: ["reused"],
      missing: "The VM did not report the desktop's display",
    },
    teardown: KILL_RECORDED,
    wipe: KILL_RECORDED,
    steps: {
      check: { timeoutMs: 30_000, label: "check the desktop stack" },
      // apt update + XFCE + the X11 tools.
      install: { timeoutMs: 15 * 60_000, label: "install the desktop stack" },
      launch: { label: "start the desktop" },
      stop: { timeoutMs: 30_000, label: "stop the desktop" },
      wipe: { timeoutMs: 30_000, label: "reset the computer" },
    },
  };
}

/** Launch, teardown and wipe do not depend on the extra packages. */
const DESKTOP_STACK = computerStack([]);

/** The desktop stack over `run`, with the owner's extra packages. */
export function computerVmStack(
  run: VmRun,
  extraPackages: readonly string[] = [],
): VmStack<LaunchDesktopOptions> {
  return createVmStack(computerStack(extraPackages), run);
}

/** Prints `ready` when the desktop stack (and every extra package) is installed, `missing` otherwise. */
export function computerStackReadyCommand(extraPackages: readonly string[] = []): string {
  return readyScript(computerStack(extraPackages));
}

/**
 * Idempotent first-run install of the desktop stack plus the owner's extra
 * packages, serialized with the browser's installer. Prints `ready` (already
 * there) or `installed`.
 */
export function installComputerStackCommand(extraPackages: readonly string[] = []): string {
  return installScript(computerStack(extraPackages));
}

/**
 * Upper bound on how long a launch script runs: its waits plus the fixed
 * sleeps and process starts.
 */
export const DESKTOP_LAUNCH_BUDGET_MS = launchBudgetMs(DESKTOP_STACK);

/**
 * Start (or reattach to) the profile's desktop: Xtigervnc at a fixed
 * geometry, vncconfig for the clipboard, a session bus, and an XFCE session
 * with its settings in the profile. Prints `ok display=<n> vnc=<port>` once a
 * window manager answers, with ` reused=1` for a desktop that was already
 * running at this size. On failure it kills what it started, prints the log
 * tails, and exits non-zero.
 */
export function launchDesktopCommand(options: LaunchDesktopOptions): string {
  return launchScript(DESKTOP_STACK, options);
}

/** The display and port a launch report names. */
export function launchedDesktop(report: Record<string, string>): LaunchedDesktop {
  return {
    display: Number(report.display),
    vncPort: Number(report.vnc),
    reused: report.reused === "1",
  };
}

export function parseDesktopLaunch(output: string): LaunchedDesktop {
  return launchedDesktop(parseReport(output, DESKTOP_STACK.report));
}

/** Stop the profile's desktop: every process group recorded at launch. */
export function teardownDesktopCommand(profileDir: string): string {
  return teardownScript(DESKTOP_STACK, profileDir);
}

/**
 * Delete the profile (the panel's Reset): XFCE settings and app state. Files
 * the bot saved in the home directory are untouched.
 */
export function wipeDesktopCommand(profileDir: string): string {
  return wipeScript(DESKTOP_STACK, profileDir);
}
