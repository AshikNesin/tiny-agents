import { parseExemptHosts } from "./browser-guard";
import { PROXY_BYPASS_FLAG } from "./egress-proxy";
import { VM_EGRESS_PROXY } from "./egress-proxy-vm";
import { shQuote } from "./shell";
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

export { LAUNCH_LOCK_FILE } from "./vm-stack";
export { shQuote };

export const STACK_VERSION = "v2";

const CHROME_POLICY = JSON.stringify({ PasswordManagerEnabled: false });
const CHROME_POLICY_DIRS = ["/etc/opt/chrome/policies/managed", "/etc/chromium/policies/managed"];

export interface LaunchStackOptions {
  profileDir: string;
  width: number;
  height: number;
  scale: number;
  locale?: string;
  timezone?: string;
  allowedPrivateHosts?: string;
}

export interface LaunchedStack {
  display: number;
  vncPort: number;
  cdpPort: number;
}

const PID_FILE = ".stack-pids";

const CDP_WAIT_SECONDS = 30;
const PROXY_WAIT_SECONDS = 5;
const STOP_WAIT_SECONDS = 10;

function stopProfileChromeLines(): string[] {
  const match = '"--user-data-dir=$PROFILE( |\\$)"';
  return [
    `pkill -f -- ${match} 2>/dev/null || true`,
    `TA_STOP=$((SECONDS + ${STOP_WAIT_SECONDS}))`,
    `while pgrep -f -- ${match} >/dev/null 2>&1 && [ "$SECONDS" -lt "$TA_STOP" ]; do sleep 0.2; done`,
  ];
}

function regionOf(options: LaunchStackOptions) {
  const tz = options.timezone ? `TZ=${shQuote(options.timezone)} ` : "";
  const { locale } = options;
  if (!locale) return { tz, flags: "" };
  const language = locale.split("-")[0];
  const languages = language && language !== locale ? `${locale},${language}` : locale;
  const flags = `--lang=${shQuote(locale)} --accept-lang=${shQuote(languages)} `;
  return { tz, flags };
}

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
    ...CHROME_POLICY_DIRS.flatMap((dir) => [
      `sudo -n mkdir -p ${dir}`,
      `printf '%s\\n' ${shQuote(CHROME_POLICY)} | sudo -n tee ${dir}/tiny-agents.json >/dev/null`,
    ]),
  ],
  launch: {
    lockHolders: "browser",
    clearPrevious: () => [
      `if [ -s "$PROFILE/${PID_FILE}" ]; then xargs -r kill < "$PROFILE/${PID_FILE}" 2>/dev/null || true; fi`,
      ...stopProfileChromeLines(),
    ],
    ports: [
      `PORTS="$(python3 -c 'import socket
held = [socket.socket() for _ in range(3)]
for s in held:
    s.bind(("127.0.0.1", 0))
print(*(s.getsockname()[1] for s in held))')"`,
      "set -- $PORTS",
      "VNC=$1",
      "CDP=$2",
      "PROXY=$3",
    ],
    prepare: () => [
      'XLOG="$PROFILE/.xvnc.log"',
      'CLOG="$PROFILE/.chrome.log"',
      `rm -f "$PROFILE/${PID_FILE}"`,
      `cat > "$PROFILE/.egress-proxy.py" <<'TA_PROXY'\n${VM_EGRESS_PROXY}TA_PROXY`,
    ],
    geometry: (options) => sizeOf(options).px,
    desktopName: "tiny-agents",
    pidFile: PID_FILE,
    xPidVariable: "XPID",
    start: (options) => {
      const { scale, cssW, cssH } = sizeOf(options);
      const region = regionOf(options);
      const exempt = [...parseExemptHosts(options.allowedPrivateHosts)].join(",");
      return [
        `setsid nohup python3 "$PROFILE/.egress-proxy.py" "$PROXY" ${shQuote(exempt)} </dev/null >"$PROFILE/.egress-proxy.log" 2>&1 ${RELEASE_LOCK} &`,
        `echo "$!" >> "$PROFILE/${PID_FILE}"`,
        `PROXYWAIT=$((SECONDS + ${PROXY_WAIT_SECONDS}))`,
        'until (exec 3<>"/dev/tcp/127.0.0.1/$PROXY") 2>/dev/null; do',
        `  [ "$SECONDS" -lt "$PROXYWAIT" ] || { echo "The browser's proxy did not start on the VM within ${PROXY_WAIT_SECONDS}s" >&2; tail -n 20 "$PROFILE/.egress-proxy.log" >&2 || true; exit 1; }`,
        "  sleep 0.1",
        "done",
        `DISPLAY=":$DISP" ${region.tz}setsid nohup google-chrome-stable ` +
          '--user-data-dir="$PROFILE" ' +
          region.flags +
          '--remote-debugging-port="$CDP" --remote-debugging-address=127.0.0.1 ' +
          `--proxy-server="http://127.0.0.1:$PROXY" ${shQuote(PROXY_BYPASS_FLAG)} ` +
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
    ...stopProfileChromeLines(),
  ],
  steps: {
    check: { timeoutMs: 15_000, label: "check the browser stack" },
    install: { timeoutMs: 10 * 60_000, label: "install the browser stack" },
    launch: { label: "start the browser" },
    stop: { timeoutMs: 15_000, label: "stop the browser" },
    wipe: { timeoutMs: 30_000, label: "reset the profile" },
  },
};

export function browserVmStack(run: VmRun): VmStack<LaunchStackOptions> {
  return createVmStack(BROWSER_STACK, run);
}

export function stackReadyCommand(): string {
  return readyScript(BROWSER_STACK);
}

export function installStackCommand(): string {
  return installScript(BROWSER_STACK);
}

export const LAUNCH_BUDGET_MS = launchBudgetMs(BROWSER_STACK);

export function launchStackCommand(options: LaunchStackOptions): string {
  return launchScript(BROWSER_STACK, options);
}

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

export function teardownStackCommand(profileDir: string): string {
  return teardownScript(BROWSER_STACK, profileDir);
}

export function wipeProfileCommand(profileDir: string): string {
  return wipeScript(BROWSER_STACK, profileDir);
}
