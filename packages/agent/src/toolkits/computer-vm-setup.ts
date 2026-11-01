/**
 * Shell builders for the computer (issue #108): an XFCE desktop on the
 * sandbox VM, one per profile, on a private X display that Xtigervnc serves
 * over RFB, beside (not inside) the browser's display. Everything here is a
 * pure string builder so the scripts can be unit-tested without a VM;
 * `computer-x11.ts` runs them over SSH.
 *
 * The rules are the browser stack's (`browser-vm-setup.ts`):
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
import { LAUNCH_LOCK_FILE, shQuote } from "./browser-vm-setup";

/** Bump when the install steps change so existing VMs re-run them. */
export const COMPUTER_STACK_VERSION = "v1";

const MARKER = `$HOME/.tiny-agents/computer-stack-${COMPUTER_STACK_VERSION}`;

/** Shared with the browser's installer: one apt at a time on the VM. */
const INSTALL_LOCK_FILE = "browser-stack.lock";

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

/** Wrap a multi-line script so it runs as one SSH exec command. */
function bash(lines: string[]): string {
  return `bash -c ${shQuote(lines.join("\n"))}`;
}

function installedTest(extra: readonly string[]): string {
  const commands = REQUIRED_COMMANDS.map((c) => `command -v ${c} >/dev/null 2>&1`).join(" && ");
  const packages = extra
    .map(
      (p) =>
        `dpkg-query -W -f='\${Status}' ${shQuote(p)} 2>/dev/null | grep -q "install ok installed"`,
    )
    .join(" && ");
  return `[ -f "$MARK" ] && ${commands}${packages ? ` && ${packages}` : ""}`;
}

/** Prints `ready` when the desktop stack (and every extra package) is installed, `missing` otherwise. */
export function computerStackReadyCommand(extraPackages: readonly string[] = []): string {
  return bash([
    `MARK="${MARKER}"`,
    `if ${installedTest(extraPackages)}; then echo ready; else echo missing; fi`,
  ]);
}

/**
 * Idempotent first-run install of the desktop stack plus the owner's extra
 * packages. Serialized with the browser's installer; waits out a dpkg lock
 * held by unattended upgrades. Prints `ready` (already there) or `installed`.
 */
export function installComputerStackCommand(extraPackages: readonly string[] = []): string {
  for (const name of extraPackages) {
    if (!PACKAGE_NAME.test(name)) throw new Error(`Not a package name: ${name}`);
  }
  const packages = [...COMPUTER_PACKAGES, ...extraPackages].join(" ");
  const ready = installedTest(extraPackages);
  return bash([
    "set -e",
    `MARK="${MARKER}"`,
    `${ready} && { echo ready; exit 0; }`,
    'mkdir -p "$HOME/.tiny-agents"',
    `exec 9>"$HOME/.tiny-agents/${INSTALL_LOCK_FILE}"`,
    "flock 9",
    `${ready} && { echo ready; exit 0; }`,
    "export DEBIAN_FRONTEND=noninteractive",
    "sudo -n apt-get -o DPkg::Lock::Timeout=180 update -qq",
    `sudo -n apt-get -o DPkg::Lock::Timeout=180 install -y -qq --no-install-recommends ${packages}`,
    "sudo -n mkdir -p /tmp/.X11-unix",
    "sudo -n chmod 1777 /tmp/.X11-unix",
    'touch "$MARK"',
    "echo installed",
  ]);
}

export interface LaunchDesktopOptions {
  /** The profile's directory on the VM (settings, pids, the session env). */
  profileDir: string;
  width: number;
  height: number;
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
export const DESKTOP_STATE_FILE = ".desktop";
/** Shell exports every tool exec sources: DISPLAY, the XDG dirs, the session bus. */
export const DESKTOP_ENV_FILE = ".desktop-env";

const LOCK_WAIT_SECONDS = 25;
const X_WAIT_SECONDS = 10;
const WM_WAIT_SECONDS = 30;

/**
 * Upper bound on how long a launch script runs: its waits plus the fixed
 * sleeps and process starts. A caller that waits this long never walks away
 * from a script still running on the VM.
 */
export const DESKTOP_LAUNCH_BUDGET_MS =
  (LOCK_WAIT_SECONDS + X_WAIT_SECONDS + WM_WAIT_SECONDS + 5) * 1000;

/** Closes the launch lock's fd (8) in a child; see `launchStackCommand`. */
const RELEASE_LOCK = "8>&-";

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

/** Kill every process group recorded for the profile, then the pids themselves. */
const KILL_RECORDED = [
  `if [ -s "$PROFILE/${DESKTOP_PID_FILE}" ]; then`,
  `  for P in $(cat "$PROFILE/${DESKTOP_PID_FILE}"); do kill -- "-$P" 2>/dev/null || true; kill "$P" 2>/dev/null || true; done`,
  "fi",
  `rm -f "$PROFILE/${DESKTOP_PID_FILE}" "$PROFILE/${DESKTOP_STATE_FILE}" "$PROFILE/${DESKTOP_ENV_FILE}"`,
];

/**
 * Start (or reattach to) the profile's desktop: Xtigervnc at a fixed
 * geometry, vncconfig for the clipboard, a session bus, and an XFCE session
 * with its settings in the profile. Prints `ok display=<n> vnc=<port>` once a
 * window manager answers, with ` reused=1` for a desktop that was already
 * running at this size. On failure it kills what it started, prints the log
 * tails, and exits non-zero.
 */
export function launchDesktopCommand(options: LaunchDesktopOptions): string {
  const width = Math.round(options.width);
  const height = Math.round(options.height);
  const size = `${width}x${height}`;
  return bash([
    "set -e",
    `PROFILE=${shQuote(options.profileDir)}`,
    'mkdir -p "$PROFILE" "$HOME/.tiny-agents"',
    'PROFILE="$(cd "$PROFILE" && pwd)"',
    `exec 8>"$HOME/.tiny-agents/${LAUNCH_LOCK_FILE}"`,
    `flock -w ${LOCK_WAIT_SECONDS} 8 || { echo "Gave up after ${LOCK_WAIT_SECONDS}s waiting for another browser or desktop to finish starting on the VM" >&2; exit 1; }`,
    // Reattach: the desktop this profile recorded is still up at this size.
    `if [ -s "$PROFILE/${DESKTOP_STATE_FILE}" ] && [ -s "$PROFILE/${DESKTOP_ENV_FILE}" ]; then`,
    `  OLD_DISP="$(sed -n 's/.*display=\\([0-9]*\\).*/\\1/p' "$PROFILE/${DESKTOP_STATE_FILE}")"`,
    `  OLD_VNC="$(sed -n 's/.*vnc=\\([0-9]*\\).*/\\1/p' "$PROFILE/${DESKTOP_STATE_FILE}")"`,
    `  OLD_SIZE="$(sed -n 's/.*size=\\([0-9x]*\\).*/\\1/p' "$PROFILE/${DESKTOP_STATE_FILE}")"`,
    `  OLD_X="$(head -n 1 "$PROFILE/${DESKTOP_PID_FILE}" 2>/dev/null || true)"`,
    `  if [ -n "$OLD_DISP" ] && [ -n "$OLD_VNC" ] && [ "$OLD_SIZE" = "${size}" ] && [ -n "$OLD_X" ] && kill -0 "$OLD_X" 2>/dev/null && [ -S "/tmp/.X11-unix/X$OLD_DISP" ] && DISPLAY=":$OLD_DISP" wmctrl -m >/dev/null 2>&1; then`,
    '    echo "ok display=$OLD_DISP vnc=$OLD_VNC reused=1"',
    "    exit 0",
    "  fi",
    "fi",
    // Whatever was recorded is stale (or at another size): stop it first.
    ...KILL_RECORDED,
    "sleep 0.3",
    `VNC="$(python3 -c 'import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()')"`,
    'DISP=""',
    "for n in $(seq 90 189); do",
    '  [ -e "/tmp/.X11-unix/X$n" ] && continue',
    '  [ -e "/tmp/.X$n-lock" ] && continue',
    '  DISP="$n"; break',
    "done",
    '[ -n "$DISP" ] || { echo "No free X display on the VM" >&2; exit 1; }',
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
    `setsid nohup Xtigervnc ":$DISP" -geometry ${size} -depth 24 -rfbport "$VNC" -localhost -nolisten tcp -SecurityTypes None -AlwaysShared -desktop tiny-agents-computer </dev/null >"$XLOG" 2>&1 ${RELEASE_LOCK} &`,
    `echo "$!" > "$PROFILE/${DESKTOP_PID_FILE}"`,
    `XWAIT=$((SECONDS + ${X_WAIT_SECONDS}))`,
    'while [ ! -S "/tmp/.X11-unix/X$DISP" ] && [ "$SECONDS" -lt "$XWAIT" ]; do sleep 0.1; done',
    'if [ ! -S "/tmp/.X11-unix/X$DISP" ]; then',
    `  echo "The display server did not start on the VM within ${X_WAIT_SECONDS}s" >&2`,
    '  tail -n 20 "$XLOG" >&2 || true',
    "  stop_started",
    "  exit 1",
    "fi",
    // vncconfig bridges X selections and VNC clipboard messages.
    `DISPLAY=":$DISP" setsid nohup vncconfig -nowin </dev/null >"$PROFILE/.vncconfig.log" 2>&1 ${RELEASE_LOCK} &`,
    `echo "$!" >> "$PROFILE/${DESKTOP_PID_FILE}"`,
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
    "export DBUS_SESSION_BUS_ADDRESS='${DBUS_SESSION_BUS_ADDRESS:-}'",
    "TA_ENV_EOF",
    `( . "$PROFILE/${DESKTOP_ENV_FILE}" && exec setsid nohup xfce4-session </dev/null >"$SLOG" 2>&1 ${RELEASE_LOCK} ) &`,
    `echo "$!" >> "$PROFILE/${DESKTOP_PID_FILE}"`,
    "UP=0",
    `WMWAIT=$((SECONDS + ${WM_WAIT_SECONDS}))`,
    'while [ "$SECONDS" -lt "$WMWAIT" ]; do',
    '  DISPLAY=":$DISP" wmctrl -m >/dev/null 2>&1 && { UP=1; break; }',
    "  sleep 0.2",
    "done",
    'if [ "$UP" != 1 ]; then',
    `  echo "The desktop did not start on the VM within ${WM_WAIT_SECONDS}s" >&2`,
    '  tail -n 20 "$XLOG" "$SLOG" >&2 || true',
    "  stop_started",
    `  rm -f "$PROFILE/${DESKTOP_ENV_FILE}"`,
    "  exit 1",
    "fi",
    `echo "display=$DISP vnc=$VNC size=${size}" > "$PROFILE/${DESKTOP_STATE_FILE}"`,
    'echo "ok display=$DISP vnc=$VNC"',
  ]);
}

export function parseDesktopLaunch(output: string): LaunchedDesktop {
  const match = /ok display=(\d+) vnc=(\d+)( reused=1)?/.exec(output);
  if (!match) throw new Error("The VM did not report the desktop's display");
  return { display: Number(match[1]), vncPort: Number(match[2]), reused: Boolean(match[3]) };
}

/** Stop the profile's desktop: every process group recorded at launch. */
export function teardownDesktopCommand(profileDir: string): string {
  return bash([`PROFILE=${shQuote(profileDir)}`, ...KILL_RECORDED]);
}

/**
 * Delete the profile (the panel's Reset): XFCE settings and app state. Files
 * the bot saved in the home directory are untouched. The pause lets the
 * just-stopped session finish exiting so it cannot rewrite its settings.
 */
export function wipeDesktopCommand(profileDir: string): string {
  return bash([`PROFILE=${shQuote(profileDir)}`, ...KILL_RECORDED, "sleep 1", 'rm -rf "$PROFILE"']);
}
