/**
 * Shell builders for the browser stack on the sandbox VM: a headful Chrome
 * drawing on a private X display that Xtigervnc serves over RFB. Everything
 * here is a pure string builder so the commands can be unit-tested without a
 * VM; `browser-remote-cdp.ts` runs them over SSH.
 *
 * The VNC and CDP ports bind to 127.0.0.1 on the VM and are only reachable
 * through the SSH channel the transport opens, which is the same trust
 * boundary the CDP port already had.
 */

/** Bump when the install steps change so existing VMs re-run them. */
export const STACK_VERSION = "v1";

const MARKER = `$HOME/.tiny-agents/browser-stack-${STACK_VERSION}`;

export function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Wrap a multi-line script so it runs as one SSH exec command. */
function bash(script: string): string {
  return `bash -c ${shQuote(script)}`;
}

/** Prints `ready` when the stack is installed, `missing` otherwise. */
export function stackReadyCommand(): string {
  return bash(
    [
      `if [ -f "${MARKER}" ] && command -v Xtigervnc >/dev/null 2>&1 && command -v google-chrome-stable >/dev/null 2>&1; then`,
      "  echo ready",
      "else",
      "  echo missing",
      "fi",
    ].join("\n"),
  );
}

/**
 * Idempotent first-run install: TigerVNC, fonts, and Google Chrome from the
 * official .deb. Serialized with flock so two bots starting at once install
 * once. Prints `ready` (already installed) or `installed`.
 */
export function installStackCommand(): string {
  return bash(
    [
      "set -e",
      `MARK="${MARKER}"`,
      '[ -f "$MARK" ] && command -v Xtigervnc >/dev/null 2>&1 && command -v google-chrome-stable >/dev/null 2>&1 && { echo ready; exit 0; }',
      'mkdir -p "$HOME/.tiny-agents"',
      'exec 9>"$HOME/.tiny-agents/browser-stack.lock"',
      "flock 9",
      '[ -f "$MARK" ] && command -v Xtigervnc >/dev/null 2>&1 && command -v google-chrome-stable >/dev/null 2>&1 && { echo ready; exit 0; }',
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
      "sudo -n mkdir -p /tmp/.X11-unix",
      "sudo -n chmod 1777 /tmp/.X11-unix",
      'touch "$MARK"',
      "echo installed",
    ].join("\n"),
  );
}

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

/**
 * Start Xtigervnc and a headful Chrome on it. Prints
 * `ok display=<n> vnc=<port> cdp=<port>` once CDP answers; on failure it
 * kills what it started, prints the log tails, and exits non-zero.
 */
export function launchStackCommand(options: LaunchStackOptions): string {
  const profile = shQuote(options.profileDir);
  const scale = options.scale === 2 ? 2 : 1;
  const cssW = Math.round(options.width);
  const cssH = Math.round(options.height);
  const px = `${cssW * scale}x${cssH * scale}`;
  return bash(
    [
      "set -e",
      `PROFILE=${profile}`,
      'mkdir -p "$PROFILE" "$HOME/.tiny-agents"',
      'exec 8>"$HOME/.tiny-agents/launch.lock"',
      "flock 8",
      // A previous app process may have died without tearing down: its Chrome
      // would hold the profile lock and swallow this launch.
      `if [ -s "$PROFILE/${PID_FILE}" ]; then xargs -r kill < "$PROFILE/${PID_FILE}" 2>/dev/null || true; fi`,
      'pkill -f -- "--user-data-dir=$PROFILE( |\\$)" 2>/dev/null || true',
      "sleep 0.5",
      // Free ports; the bind-then-close window is short and the lock above
      // serializes launches on this VM.
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
      'DISP=""',
      "for n in $(seq 90 189); do",
      '  [ -e "/tmp/.X11-unix/X$n" ] && continue',
      '  [ -e "/tmp/.X$n-lock" ] && continue',
      '  DISP="$n"; break',
      "done",
      '[ -n "$DISP" ] || { echo "No free X display on the VM" >&2; exit 1; }',
      'XLOG="$PROFILE/.xvnc.log"',
      'CLOG="$PROFILE/.chrome.log"',
      `rm -f "$PROFILE/${PID_FILE}"`,
      'setsid nohup Xtigervnc ":$DISP" -geometry ' +
        px +
        ' -depth 24 -rfbport "$VNC" -localhost -nolisten tcp -SecurityTypes None -AlwaysShared -desktop tiny-agents </dev/null >"$XLOG" 2>&1 &',
      "XPID=$!",
      `echo "$XPID" > "$PROFILE/${PID_FILE}"`,
      'for i in $(seq 1 100); do [ -S "/tmp/.X11-unix/X$DISP" ] && break; sleep 0.1; done',
      // vncconfig is the bridge between X selections and VNC clipboard
      // messages: without it copy/paste never reaches the viewer.
      'DISPLAY=":$DISP" setsid nohup vncconfig -nowin </dev/null >"$PROFILE/.vncconfig.log" 2>&1 &',
      `echo "$!" >> "$PROFILE/${PID_FILE}"`,
      'DISPLAY=":$DISP" setsid nohup google-chrome-stable ' +
        '--user-data-dir="$PROFILE" ' +
        '--remote-debugging-port="$CDP" --remote-debugging-address=127.0.0.1 ' +
        `--window-position=0,0 --window-size=${cssW},${cssH} --force-device-scale-factor=${scale} ` +
        "--no-first-run --no-default-browser-check --password-store=basic --use-mock-keychain " +
        "--disable-features=Translate,MediaRouter --disable-session-crashed-bubble --hide-crash-restore-bubble " +
        'about:blank </dev/null >"$CLOG" 2>&1 &',
      "CPID=$!",
      `echo "$CPID" >> "$PROFILE/${PID_FILE}"`,
      "UP=0",
      'for i in $(seq 1 150); do curl -sf "http://127.0.0.1:$CDP/json/version" >/dev/null 2>&1 && { UP=1; break; }; sleep 0.2; done',
      'if [ "$UP" != 1 ]; then',
      '  echo "Chrome did not start on the VM within 30s" >&2',
      '  tail -n 20 "$XLOG" "$CLOG" >&2 || true',
      '  kill "$CPID" "$XPID" 2>/dev/null || true',
      `  rm -f "$PROFILE/${PID_FILE}"`,
      "  exit 1",
      "fi",
      'echo "ok display=$DISP vnc=$VNC cdp=$CDP"',
    ].join("\n"),
  );
}

export function parseLaunchOutput(output: string): LaunchedStack {
  const match = /ok display=(\d+) vnc=(\d+) cdp=(\d+)/.exec(output);
  if (!match) throw new Error("The VM did not report the browser stack ports");
  return { display: Number(match[1]), vncPort: Number(match[2]), cdpPort: Number(match[3]) };
}

/** Kill the Xtigervnc and Chrome recorded at launch. */
export function teardownStackCommand(profileDir: string): string {
  const profile = shQuote(profileDir);
  return bash(
    [
      `PROFILE=${profile}`,
      `cat "$PROFILE/${PID_FILE}" 2>/dev/null | xargs -r kill 2>/dev/null || true`,
      `rm -f "$PROFILE/${PID_FILE}"`,
    ].join("\n"),
  );
}

/**
 * Delete the profile directory (the "Reset profile" action). The pause lets
 * the just-killed Chrome finish exiting so it cannot rewrite files.
 */
export function wipeProfileCommand(profileDir: string): string {
  return `sleep 1; rm -rf ${shQuote(profileDir)}`;
}
