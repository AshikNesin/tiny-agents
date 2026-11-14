/**
 * The browser stack on the sandbox VM, one `VmStack` (`vm-stack.ts`): a
 * headful Chrome drawing on a private X display that Xtigervnc serves over
 * RFB. The builders are pure strings so the commands can be unit-tested
 * without a VM; `browser-remote-cdp.ts` runs them over SSH.
 *
 * The VNC and CDP ports bind to 127.0.0.1 on the VM and are only reachable
 * through the SSH channel the transport opens, which is the same trust
 * boundary the CDP port already had.
 */
import {
  createVmStack,
  installScript,
  launchBudgetMs,
  launchScript,
  parseReport,
  readyScript,
  RELEASE_LOCK,
  teardownScript,
  type VmRun,
  type VmStack,
  type VmStackSpec,
  wipeScript,
} from "./vm-stack";

// Where the browser setup suite imports them from.
export { LAUNCH_LOCK_FILE } from "./vm-stack";
export { shQuote } from "./shell";

/** Bump when the install steps change so existing VMs re-run them. */
export const STACK_VERSION = "v1";

export interface LaunchStackOptions {
  /** Chrome user-data-dir on the VM (also holds pid and log files). */
  profileDir: string;
  /** Initial window size in CSS pixels. */
  width: number;
  height: number;
  /** Device pixel ratio of the desktop (1 or 2). */
  scale: number;
}

export interface LaunchedStack {
  display: number;
  vncPort: number;
  cdpPort: number;
}

const PID_FILE = ".stack-pids";

const CDP_WAIT_SECONDS = 30;
/** How long a launch waits for an earlier Chrome on the profile to exit. */
const STOP_WAIT_SECONDS = 10;

/**
 * Stop every Chrome running on `$PROFILE` (the browser's, or the computer's
 * on the same profile) and wait up to `STOP_WAIT_SECONDS` for it to exit, so the next Chrome
 * finds the profile unlocked and its cookies written.
 */
function stopProfileChromeLines(): string[] {
  const match = '"--user-data-dir=$PROFILE( |\\$)"';
  return [
    `pkill -f -- ${match} 2>/dev/null || true`,
    `TA_STOP=$((SECONDS + ${STOP_WAIT_SECONDS}))`,
    `while pgrep -f -- ${match} >/dev/null 2>&1 && [ "$SECONDS" -lt "$TA_STOP" ]; do sleep 0.2; done`,
  ];
}

/** CSS size, pixel density and the display's pixel geometry of a launch. */
function sizeOf(options: LaunchStackOptions) {
  const scale = options.scale === 2 ? 2 : 1;
  const cssW = Math.round(options.width);
  const cssH = Math.round(options.height);
  return { scale, cssW, cssH, px: `${cssW * scale}x${cssH * scale}` };
}

const BROWSER_STACK: VmStackSpec<LaunchStackOptions> = {
  marker: `browser-stack-${STACK_VERSION}`,
  commands: ["Xtigervnc", "google-chrome-stable"],
  readyLayout: "inline",
  // TigerVNC, fonts, and Google Chrome from the official .deb.
  installSteps: () => [
    'ARCH="$(dpkg --print-architecture)"',
    '[ "$ARCH" = amd64 ] || { echo "Unsupported VM architecture: $ARCH (Chrome needs amd64)" >&2; exit 1; }',
    "export DEBIAN_FRONTEND=noninteractive",
    "sudo -n apt-get update -qq",
    "sudo -n apt-get install -y -qq --no-install-recommends tigervnc-standalone-server tigervnc-common fonts-liberation fonts-dejavu-core fonts-noto-color-emoji ca-certificates curl",
    "if ! command -v google-chrome-stable >/dev/null 2>&1; then",
    '  TMP="$(mktemp -d)"',
    '  curl -fsSL -o "$TMP/chrome.deb" https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb',
    '  sudo -n apt-get install -y -qq "$TMP/chrome.deb"',
    '  rm -rf "$TMP"',
    "fi",
  ],
  launch: {
    lockHolders: "browser",
    // A previous app process may have died without tearing down, or the
    // owner opened this profile in the computer's Chrome: either holds the
    // profile lock and would swallow this launch. Chrome flushes cookies on
    // SIGTERM, so the profile's logins carry over.
    clearPrevious: () => [
      `if [ -s "$PROFILE/${PID_FILE}" ]; then xargs -r kill < "$PROFILE/${PID_FILE}" 2>/dev/null || true; fi`,
      ...stopProfileChromeLines(),
    ],
    ports: [
      `PORTS="$(python3 -c 'import socket
def free():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p
print(free(), free())')"`,
      "set -- $PORTS",
      "VNC=$1",
      "CDP=$2",
    ],
    prepare: () => [
      'XLOG="$PROFILE/.xvnc.log"',
      'CLOG="$PROFILE/.chrome.log"',
      `rm -f "$PROFILE/${PID_FILE}"`,
    ],
    geometry: (options) => sizeOf(options).px,
    desktopName: "tiny-agents",
    pidFile: PID_FILE,
    xPidVariable: "XPID",
    start: (options) => {
      const { scale, cssW, cssH } = sizeOf(options);
      return [
        'DISPLAY=":$DISP" setsid nohup google-chrome-stable ' +
          '--user-data-dir="$PROFILE" ' +
          '--remote-debugging-port="$CDP" --remote-debugging-address=127.0.0.1 ' +
          `--window-position=0,0 --window-size=${cssW},${cssH} --force-device-scale-factor=${scale} ` +
          "--no-first-run --no-default-browser-check --password-store=basic --use-mock-keychain " +
          "--disable-features=Translate,MediaRouter --disable-session-crashed-bubble --hide-crash-restore-bubble " +
          `about:blank </dev/null >"$CLOG" 2>&1 ${RELEASE_LOCK} &`,
        "CPID=$!",
        `echo "$CPID" >> "$PROFILE/${PID_FILE}"`,
      ];
    },
    up: {
      probe: 'curl -sf --max-time 2 "http://127.0.0.1:$CDP/json/version" >/dev/null 2>&1',
      seconds: CDP_WAIT_SECONDS,
      deadline: "CDPWAIT",
      failure: `Chrome did not start on the VM within ${CDP_WAIT_SECONDS}s`,
      logs: '"$XLOG" "$CLOG"',
      cleanup: [
        `xargs -r kill < "$PROFILE/${PID_FILE}" 2>/dev/null || true`,
        `rm -f "$PROFILE/${PID_FILE}"`,
      ],
    },
    otherWaitSeconds: STOP_WAIT_SECONDS,
  },
  report: {
    variables: { display: "DISP", vnc: "VNC", cdp: "CDP" },
    missing: "The VM did not report the browser stack ports",
  },
  teardown: [
    `cat "$PROFILE/${PID_FILE}" 2>/dev/null | xargs -r kill 2>/dev/null || true`,
    `rm -f "$PROFILE/${PID_FILE}"`,
  ],
  wipe: [
    'if [ -d "$PROFILE" ]; then PROFILE="$(cd "$PROFILE" && pwd)"; fi',
    // The computer's Chrome may have the profile open too.
    ...stopProfileChromeLines(),
  ],
  steps: {
    check: { timeoutMs: 15_000, label: "check the browser stack" },
    // apt update + TigerVNC + the Chrome .deb.
    install: { timeoutMs: 10 * 60_000, label: "install the browser stack" },
    launch: { label: "start the browser" },
    stop: { timeoutMs: 15_000, label: "stop the browser" },
    wipe: { timeoutMs: 30_000, label: "reset the profile" },
  },
};

/** The browser stack over `run`. */
export function browserVmStack(run: VmRun): VmStack<LaunchStackOptions> {
  return createVmStack(BROWSER_STACK, run);
}

/** Prints `ready` when the stack is installed, `missing` otherwise. */
export function stackReadyCommand(): string {
  return readyScript(BROWSER_STACK);
}

/**
 * Idempotent first-run install, serialized with flock so two bots starting
 * at once install once. Prints `ready` (already installed) or `installed`.
 */
export function installStackCommand(): string {
  return installScript(BROWSER_STACK);
}

/** Upper bound on how long a launch script runs: its four waits plus the fixed sleeps and process starts. */
export const LAUNCH_BUDGET_MS = launchBudgetMs(BROWSER_STACK);

/**
 * Start Xtigervnc and a headful Chrome on it. Prints
 * `ok display=<n> vnc=<port> cdp=<port>` once CDP answers; on failure it
 * kills what it started, prints the log tails, and exits non-zero.
 */
export function launchStackCommand(options: LaunchStackOptions): string {
  return launchScript(BROWSER_STACK, options);
}

/** The ports a launch report names. */
export function launchedStack(report: Record<string, string>): LaunchedStack {
  return {
    display: Number(report.display),
    vncPort: Number(report.vnc),
    cdpPort: Number(report.cdp),
  };
}

export function parseLaunchOutput(output: string): LaunchedStack {
  return launchedStack(parseReport(output, BROWSER_STACK.report));
}

/** Kill the Xtigervnc and Chrome recorded at launch. */
export function teardownStackCommand(profileDir: string): string {
  return teardownScript(BROWSER_STACK, profileDir);
}

/** Delete the profile directory (the "Reset profile" action). */
export function wipeProfileCommand(profileDir: string): string {
  return wipeScript(BROWSER_STACK, profileDir);
}
