/**
 * A fake computer for the toolkit and route tests: records every call, and
 * answers screenshots with a tiny JPEG-shaped buffer.
 */
import type {
  ComputerDesktop,
  ComputerTransport,
  ComputerWindow,
  WindowBinding,
} from "../../../../packages/agent/src/toolkits/computer-sessions";
import {
  DesktopGoneError,
  WindowMismatchError,
} from "../../../../packages/agent/src/toolkits/computer-sessions";

export const FAKE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

export interface FakeComputer {
  transport: ComputerTransport;
  log: { method: string; args?: unknown; profile: string }[];
  /** Profiles opened, in order (a relaunch shows up twice). */
  opened: string[];
  wiped: string[];
  windows: ComputerWindow[];
  /** What `typeSecret` typed, by window class (tests assert the value went there). */
  typedSecrets: { value: string; binding: WindowBinding }[];
  /** The next tool call on this profile finds the desktop gone. */
  killNext(profile: string): void;
  /** Make the next open fail with this message. */
  failNextOpen(message: string): void;
  /** Hold opens until released (to observe the `starting` phase). */
  holdOpens(): () => void;
  /** The desktop most recently opened for a profile. */
  desktop(profile: string): ComputerDesktop | undefined;
}

export function fakeComputer(): FakeComputer {
  const log: FakeComputer["log"] = [];
  const opened: string[] = [];
  const wiped: string[] = [];
  const typedSecrets: FakeComputer["typedSecrets"] = [];
  const dying = new Set<string>();
  const desktops = new Map<string, ComputerDesktop>();
  let openFailure: string | undefined;
  let hold: Promise<void> | undefined;
  const windows: ComputerWindow[] = [
    { id: "0x02200003", windowClass: "mousepad.Mousepad", title: "Untitled 1", active: true },
    { id: "0x02400004", windowClass: "Thunar.Thunar", title: "Home", active: false },
  ];

  const transport: ComputerTransport = {
    async open(profile, options) {
      await hold;
      if (openFailure) {
        const message = openFailure;
        openFailure = undefined;
        throw new Error(message);
      }
      opened.push(profile);
      const listeners: (() => void)[] = [];
      const call = async (method: string, args?: unknown) => {
        log.push({ method, args, profile });
        if (dying.delete(profile)) {
          for (const listener of listeners.splice(0)) listener();
          throw new DesktopGoneError();
        }
      };
      const desktop: ComputerDesktop = {
        width: options.width,
        height: options.height,
        vnc: { openStream: async () => Promise.reject(new Error("no stream in tests")) },
        async screenshot(region) {
          await call("screenshot", region);
          return FAKE_JPEG;
        },
        async cursorPosition() {
          await call("cursorPosition");
          return { x: 10, y: 20 };
        },
        click: (x, y, opts) => call("click", { x, y, ...opts }),
        move: (x, y) => call("move", { x, y }),
        drag: (from, to) => call("drag", { from, to }),
        scroll: (x, y, direction, amount) => call("scroll", { x, y, direction, amount }),
        type: (text) => call("type", { text }),
        key: (chords, repeat) => call("key", { chords, repeat }),
        async listWindows() {
          await call("listWindows");
          return windows;
        },
        focusWindow: (id) => call("focusWindow", { id }),
        closeWindow: (id) => call("closeWindow", { id }),
        async listApps() {
          await call("listApps");
          return [{ id: "org.xfce.mousepad", name: "Mousepad" }];
        },
        openApp: (id) => call("openApp", { id }),
        async clipboardGet() {
          await call("clipboardGet");
          return "copied text";
        },
        clipboardSet: (text) => call("clipboardSet", { text }),
        async typeSecret(value, binding) {
          await call("typeSecret", { binding });
          const active = windows.find((w) => w.active);
          const classes = active?.windowClass.toLowerCase().split(".") ?? [];
          if (
            !active ||
            !classes.includes(binding.windowClass.toLowerCase()) ||
            !active.title.toLowerCase().includes((binding.title ?? "").toLowerCase())
          ) {
            throw new WindowMismatchError(`${active?.windowClass}: ${active?.title}`);
          }
          typedSecrets.push({ value, binding });
        },
        onDisconnect: (listener) => void listeners.push(listener),
        async close() {
          log.push({ method: "close", profile });
        },
      };
      desktops.set(profile, desktop);
      return desktop;
    },
    async wipe(profile) {
      wiped.push(profile);
    },
  };

  return {
    transport,
    log,
    opened,
    wiped,
    windows,
    typedSecrets,
    killNext: (profile) => void dying.add(profile),
    failNextOpen: (message) => void (openFailure = message),
    holdOpens() {
      let release!: () => void;
      hold = new Promise((resolve) => (release = resolve));
      return () => {
        hold = undefined;
        release();
      };
    },
    desktop: (profile) => desktops.get(profile),
  };
}
