/**
 * The computer's production transport (issue #108): a desktop on the
 * sandbox VM, seen with `scrot` and driven with `xdotool`, `wmctrl` and
 * `xclip`, exactly Anthropic's reference stack. Every tool call is one exec
 * on the app's sandbox connection, sourcing the desktop's env file so it
 * reaches the right display and session bus; the live view is a forward on
 * the same connection.
 *
 * Text the bot types, clipboard text and vault values travel on the exec's
 * stdin, never on its command line: `ps` on the VM shows argv.
 *
 * The command builders are pure and exported for tests; the transport is the
 * only part that reaches the sandbox.
 */
import { SandboxTimeoutError } from "../ssh/connection";
import type { SandboxConnection } from "../ssh/sandbox-connection";
import { shQuote } from "./browser-vm-setup";
import {
  DesktopGoneError,
  WindowMismatchError,
  type ComputerApp,
  type ComputerDesktop,
  type ComputerTransport,
  type ComputerWindow,
  type KeyModifier,
  type MouseButton,
  type ScrollDirection,
  type WindowBinding,
} from "./computer-sessions";
import {
  COMPUTER_PROFILES_DIR,
  computerStackReadyCommand,
  DESKTOP_ENV_FILE,
  DESKTOP_LAUNCH_BUDGET_MS,
  installComputerStackCommand,
  launchDesktopCommand,
  parseDesktopLaunch,
  teardownDesktopCommand,
  wipeDesktopCommand,
} from "./computer-vm-setup";

/** Exit code of a tool exec whose desktop is gone (no env file, no X server). */
export const DESKTOP_GONE_EXIT = 97;
/** Exit code of `typeSecret` when another window is in front. */
export const WINDOW_MISMATCH_EXIT = 96;
/** Exit code of `openApp` for an unknown desktop entry. */
const NO_SUCH_APP_EXIT = 95;

const BUTTONS: Record<MouseButton, number> = { left: 1, middle: 2, right: 3 };
const SCROLL_BUTTONS: Record<ScrollDirection, number> = { up: 4, down: 5, left: 6, right: 7 };

/** The profile's directory on the VM. */
export function desktopProfileDir(profile: string): string {
  if (!/^[\w-]{1,64}$/.test(profile)) throw new Error(`Invalid computer profile "${profile}".`);
  return `${COMPUTER_PROFILES_DIR}/${profile}`;
}

/**
 * Run `body` against the profile's desktop: source its env, check the X
 * server answers, then the body. A missing desktop exits `DESKTOP_GONE_EXIT`.
 */
export function desktopCommand(profileDir: string, body: string): string {
  const script = [
    `PROFILE=${shQuote(profileDir)}`,
    `[ -f "$PROFILE/${DESKTOP_ENV_FILE}" ] || { echo "The desktop is not running" >&2; exit ${DESKTOP_GONE_EXIT}; }`,
    `. "$PROFILE/${DESKTOP_ENV_FILE}"`,
    `[ -S "/tmp/.X11-unix/X\${DISPLAY#:}" ] || { echo "The desktop is not running" >&2; exit ${DESKTOP_GONE_EXIT}; }`,
    body,
  ].join("\n");
  return `bash -c ${shQuote(script)}`;
}

const int = (value: number, name: string) => {
  if (!Number.isInteger(value)) throw new Error(`${name} must be a whole number`);
  return String(value);
};

/** JPEG of the desktop (or a region) on stdout, mouse pointer included. */
export function screenshotBody(region?: {
  x: number;
  y: number;
  width: number;
  height: number;
}): string {
  const area = region
    ? ` -a ${int(region.x, "x")},${int(region.y, "y")},${int(region.width, "width")},${int(region.height, "height")}`
    : "";
  return [
    'F="$(mktemp /tmp/ta-shot-XXXXXX.jpg)"',
    `scrot -o -p -q 80${area} "$F" >/dev/null 2>&1 || { rm -f "$F"; echo "scrot failed" >&2; exit 1; }`,
    'cat "$F"',
    'rm -f "$F"',
  ].join("\n");
}

function cursorBody(): string {
  return "xdotool getmouselocation --shell";
}

function modifierArgs(modifiers: KeyModifier[], down: boolean): string {
  return modifiers.map((m) => `${down ? "keydown" : "keyup"} ${m}`).join(" ");
}

export function clickBody(
  x: number,
  y: number,
  options: { button: MouseButton; count: number; modifiers: KeyModifier[] },
): string {
  const parts = [
    `xdotool mousemove ${int(x, "x")} ${int(y, "y")} sleep 0.05`,
    modifierArgs(options.modifiers, true),
    `click --repeat ${int(options.count, "count")} --delay 80 ${BUTTONS[options.button]}`,
    modifierArgs(options.modifiers, false),
  ];
  return parts.filter(Boolean).join(" ");
}

function moveBody(x: number, y: number): string {
  return `xdotool mousemove ${int(x, "x")} ${int(y, "y")}`;
}

function dragBody(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const midX = Math.round((from.x + to.x) / 2);
  const midY = Math.round((from.y + to.y) / 2);
  return (
    `xdotool mousemove ${int(from.x, "x")} ${int(from.y, "y")} sleep 0.05 mousedown 1 sleep 0.1 ` +
    `mousemove ${midX} ${midY} sleep 0.05 mousemove ${int(to.x, "x")} ${int(to.y, "y")} sleep 0.1 mouseup 1`
  );
}

export function scrollBody(
  x: number,
  y: number,
  direction: ScrollDirection,
  amount: number,
): string {
  return `xdotool mousemove ${int(x, "x")} ${int(y, "y")} sleep 0.05 click --repeat ${int(amount, "amount")} --delay 30 ${SCROLL_BUTTONS[direction]}`;
}

/** Types stdin; the text never appears in the command. */
export function typeBody(): string {
  return "xdotool type --clearmodifiers --delay 12 --file -";
}

export function keyBody(chords: string[], repeat: number): string {
  for (const chord of chords) {
    if (!/^[A-Za-z0-9_+]+$/.test(chord)) throw new Error(`Not a key name: ${chord}`);
  }
  return `xdotool key --clearmodifiers --repeat ${int(repeat, "repeat")} --delay 80 -- ${chords.join(" ")}`;
}

function listWindowsBody(): string {
  return ["wmctrl -l -x", 'echo "--active"', "xdotool getactivewindow 2>/dev/null || true"].join(
    "\n",
  );
}

const WINDOW_ID = /^0x[0-9a-f]{1,8}$/i;

export function checkWindowId(id: string): string {
  if (!WINDOW_ID.test(id)) throw new Error(`Not a window id: ${id}. Use computer_list_windows.`);
  return id.toLowerCase();
}

function focusWindowBody(id: string): string {
  return `wmctrl -i -a ${checkWindowId(id)}`;
}

function closeWindowBody(id: string): string {
  return `wmctrl -i -c ${checkWindowId(id)}`;
}

/** `<id>\t<name>` per visible application entry, user entries first. */
function listAppsBody(): string {
  return [
    'for D in "${XDG_DATA_HOME:-$HOME/.local/share}/applications" "$HOME/.local/share/applications" /usr/local/share/applications /usr/share/applications; do',
    '  [ -d "$D" ] || continue',
    '  for F in "$D"/*.desktop; do',
    '    [ -f "$F" ] || continue',
    '    awk -v id="$(basename "$F" .desktop)" -F= \'',
    "      /^\\[/ { section = $0; next }",
    '      section != "[Desktop Entry]" { next }',
    '      $1 == "Name" && name == "" { name = substr($0, 6) }',
    '      $1 == "Type" { type = $2 }',
    '      ($1 == "NoDisplay" || $1 == "Hidden") && $2 == "true" { hidden = 1 }',
    '      END { if (!hidden && type == "Application" && name != "") print id "\\t" name }',
    '    \' "$F"',
    "  done",
    "done",
  ].join("\n");
}

const APP_ID = /^[\w.+-]{1,128}$/;

export function openAppBody(id: string): string {
  if (!APP_ID.test(id)) throw new Error(`Not an application id: ${id}. Use computer_list_apps.`);
  return [
    `ID=${shQuote(id)}`,
    'F=""',
    'for D in "${XDG_DATA_HOME:-$HOME/.local/share}/applications" "$HOME/.local/share/applications" /usr/local/share/applications /usr/share/applications; do',
    '  [ -f "$D/$ID.desktop" ] && { F="$D/$ID.desktop"; break; }',
    "done",
    `[ -n "$F" ] || { echo "No application $ID" >&2; exit ${NO_SUCH_APP_EXIT}; }`,
    "if command -v gtk-launch >/dev/null 2>&1; then",
    '  setsid -f gtk-launch "$ID" </dev/null >/dev/null 2>&1',
    "else",
    '  setsid -f gio launch "$F" </dev/null >/dev/null 2>&1',
    "fi",
  ].join("\n");
}

function clipboardGetBody(): string {
  return "xclip -selection clipboard -o 2>/dev/null || true";
}

/** Sets the clipboard from stdin; xclip stays behind as the selection owner. */
function clipboardSetBody(): string {
  return "xclip -selection clipboard -i >/dev/null 2>&1";
}

/**
 * Check the active window against the binding, then type stdin into it, in
 * one exec so nothing else can come to the front in between.
 */
export function typeSecretBody(binding: WindowBinding): string {
  return [
    `WANT_CLASS=${shQuote(binding.windowClass.toLowerCase())}`,
    `WANT_TITLE=${shQuote((binding.title ?? "").toLowerCase())}`,
    'WID="$(xdotool getactivewindow 2>/dev/null || true)"',
    `[ -n "$WID" ] || { echo "no window" >&2; exit ${WINDOW_MISMATCH_EXIT}; }`,
    'HEX="$(printf "0x%08x" "$WID")"',
    `CLASS="$(wmctrl -l -x | awk -v id="$HEX" '$1 == id { print $3; exit }')"`,
    'TITLE="$(xdotool getwindowname "$WID" 2>/dev/null || true)"',
    'LC_CLASS="${CLASS,,}"',
    'LC_TITLE="${TITLE,,}"',
    "MATCH=0",
    'case ".$LC_CLASS." in *".$WANT_CLASS."*) MATCH=1 ;; esac',
    'if [ "$MATCH" = 1 ] && [ -n "$WANT_TITLE" ]; then case "$LC_TITLE" in *"$WANT_TITLE"*) ;; *) MATCH=0 ;; esac; fi',
    `[ "$MATCH" = 1 ] || { echo "$CLASS: $TITLE" >&2; exit ${WINDOW_MISMATCH_EXIT}; }`,
    typeBody(),
  ].join("\n");
}

/** `wmctrl -l -x` plus the active id (decimal, from xdotool) → windows. */
export function parseWindows(output: string): ComputerWindow[] {
  const [list, active = ""] = output.split("--active");
  const activeId = Number.parseInt(active.trim(), 10);
  const windows: ComputerWindow[] = [];
  for (const line of list.split("\n")) {
    // 0x02200003  0 mousepad.Mousepad  host Untitled 1 - Mousepad
    const match = /^(0x[0-9a-f]+)\s+(-?\d+)\s+(\S+)\s+\S+\s?(.*)$/i.exec(line.trim());
    if (!match) continue;
    // Sticky windows (desktop -1) are the panel and the desktop background.
    if (match[2] === "-1") continue;
    windows.push({
      id: match[1].toLowerCase(),
      windowClass: match[3],
      title: match[4].trim(),
      active: Number.isFinite(activeId) && Number.parseInt(match[1], 16) === activeId,
    });
  }
  return windows;
}

export function parseApps(output: string): ComputerApp[] {
  const seen = new Set<string>();
  const apps: ComputerApp[] = [];
  for (const line of output.split("\n")) {
    const [id, name] = line.split("\t");
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    apps.push({ id, name: name.trim() });
  }
  return apps.sort((a, b) => a.name.localeCompare(b.name));
}

export function parseCursor(output: string): { x: number; y: number } {
  const x = /X=(\d+)/.exec(output);
  const y = /Y=(\d+)/.exec(output);
  if (!x || !y) throw new Error("Could not read the pointer position");
  return { x: Number(x[1]), y: Number(y[1]) };
}

export interface X11ComputerTransportOptions {
  /** The app's connection to the sandbox VM. */
  connection: SandboxConnection;
  /** `COMPUTER_EXTRA_PACKAGES`, already validated. */
  extraPackages?: string[];
  /**
   * The browser toolkit's profiles root on the VM. Set, each desktop's Chrome
   * opens the browser profile of the same key (`<root>/<profile>`), so a site
   * signed into in either one is signed in in both.
   */
  browserProfilesDir?: string;
}

interface ExecResult {
  stdout: Buffer;
  stderr: string;
  code: number;
}

/** First-run install budget: apt update + XFCE + the X11 tools. */
const INSTALL_TIMEOUT_MS = 15 * 60_000;
const LAUNCH_TIMEOUT_MS = DESKTOP_LAUNCH_BUDGET_MS + 20_000;
const TOOL_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 12 * 1024 * 1024;

export function createX11ComputerTransport(
  options: X11ComputerTransportOptions,
): ComputerTransport {
  const extra = options.extraPackages ?? [];
  const { connection } = options;

  /** One command; stdin (if any) is written and closed. */
  const run = async (
    command: string,
    { stdin, timeoutMs = TOOL_TIMEOUT_MS }: { stdin?: string; timeoutMs?: number } = {},
  ): Promise<ExecResult> => {
    try {
      const result = await connection.exec(command, {
        stdin,
        timeoutMs,
        maxBytes: MAX_OUTPUT_BYTES,
        // A command that leaves a child behind (xclip, a launched app) may
        // never close its channel: settle shortly after it exits.
        settleOnExit: true,
      });
      return { stdout: result.stdout, stderr: result.stderr.slice(0, 4000), code: result.exitCode };
    } catch (error) {
      if (error instanceof SandboxTimeoutError) {
        throw new Error(`The computer did not answer within ${timeoutMs / 1000}s`);
      }
      throw error;
    }
  };

  const ok = async (command: string, what: string, opts?: Parameters<typeof run>[1]) => {
    const result = await run(command, opts);
    if (result.code === 0) return result.stdout;
    const detail = (result.stderr || result.stdout.toString("utf8")).trim().slice(-600);
    throw new Error(
      `Could not ${what} on the VM (exit ${result.code})${detail ? `: ${detail}` : ""}`,
    );
  };

  return {
    async open(profile, open) {
      const dir = desktopProfileDir(profile);
      const ready = (await ok(computerStackReadyCommand(extra), "check the desktop stack"))
        .toString("utf8")
        .trim();
      if (ready !== "ready") {
        open.onPhase?.("installing");
        await ok(installComputerStackCommand(extra), "install the desktop stack", {
          timeoutMs: INSTALL_TIMEOUT_MS,
        });
      }
      open.onPhase?.("starting");
      let launched;
      try {
        launched = parseDesktopLaunch(
          (
            await ok(
              launchDesktopCommand({
                profileDir: dir,
                width: open.width,
                height: open.height,
                browserProfileDir: options.browserProfilesDir
                  ? `${options.browserProfilesDir.replace(/\/$/, "")}/${profile}`
                  : undefined,
              }),
              "start the desktop",
              { timeoutMs: LAUNCH_TIMEOUT_MS },
            )
          ).toString("utf8"),
        );
      } catch (error) {
        await run(teardownDesktopCommand(dir)).catch(() => {});
        throw error;
      }

      let closed = false;
      const listeners: (() => void)[] = [];
      const gone = () => {
        if (closed) return;
        closed = true;
        for (const listener of listeners.splice(0)) listener();
      };

      /** One tool exec against this desktop. */
      const tool = async (body: string, what: string, stdin?: string): Promise<ExecResult> => {
        if (closed) throw new DesktopGoneError();
        const result = await run(desktopCommand(dir, body), { stdin });
        if (result.code === DESKTOP_GONE_EXIT) {
          gone();
          throw new DesktopGoneError();
        }
        if (
          result.code !== 0 &&
          result.code !== WINDOW_MISMATCH_EXIT &&
          result.code !== NO_SUCH_APP_EXIT
        ) {
          const detail = result.stderr.trim().slice(-400);
          throw new Error(`Could not ${what}${detail ? `: ${detail}` : ""}`);
        }
        return result;
      };
      const text = async (body: string, what: string) =>
        (await tool(body, what)).stdout.toString("utf8");

      const desktop: ComputerDesktop = {
        width: open.width,
        height: open.height,
        vnc: { openStream: () => connection.forward(launched.vncPort) },
        async screenshot(region) {
          const shot = (await tool(screenshotBody(region), "take a screenshot")).stdout;
          if (shot.length < 4 || shot[0] !== 0xff || shot[1] !== 0xd8) {
            throw new Error("The screenshot came back empty");
          }
          return shot;
        },
        async cursorPosition() {
          return parseCursor(await text(cursorBody(), "read the pointer"));
        },
        async click(x, y, opts) {
          await tool(clickBody(x, y, opts), "click");
        },
        async move(x, y) {
          await tool(moveBody(x, y), "move the pointer");
        },
        async drag(from, to) {
          await tool(dragBody(from, to), "drag");
        },
        async scroll(x, y, direction, amount) {
          await tool(scrollBody(x, y, direction, amount), "scroll");
        },
        async type(value) {
          await tool(typeBody(), "type", value);
        },
        async key(chords, repeat) {
          await tool(keyBody(chords, repeat), "press keys");
        },
        async listWindows() {
          return parseWindows(await text(listWindowsBody(), "list windows"));
        },
        async focusWindow(id) {
          await tool(focusWindowBody(id), "focus the window");
        },
        async closeWindow(id) {
          await tool(closeWindowBody(id), "close the window");
        },
        async listApps() {
          return parseApps(await text(listAppsBody(), "list applications"));
        },
        async openApp(id) {
          const result = await tool(openAppBody(id), "open the application");
          if (result.code === NO_SUCH_APP_EXIT) {
            throw new Error(`No application "${id}". Use computer_list_apps for the ids.`);
          }
        },
        async clipboardGet() {
          return text(clipboardGetBody(), "read the clipboard");
        },
        async clipboardSet(value) {
          await tool(clipboardSetBody(), "set the clipboard", value);
        },
        async typeSecret(value, binding) {
          const result = await tool(typeSecretBody(binding), "type", value);
          if (result.code === WINDOW_MISMATCH_EXIT) {
            throw new WindowMismatchError(result.stderr.trim().slice(0, 200));
          }
        },
        onDisconnect(listener) {
          if (closed) setTimeout(listener, 0);
          else listeners.push(listener);
        },
        async close() {
          closed = true;
          listeners.length = 0;
          await run(teardownDesktopCommand(dir)).catch(() => {});
        },
      };
      return desktop;
    },
    async wipe(profile) {
      await ok(wipeDesktopCommand(desktopProfileDir(profile)), "reset the computer");
    },
  };
}
