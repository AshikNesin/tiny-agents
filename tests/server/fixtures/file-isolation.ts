/**
 * Test files in the `server` project share one module graph per worker
 * (`isolate: false`), so whatever a file leaves behind is there for the next
 * file in that worker. After every file the setup resets what it owns and
 * fails the file if something it cannot reset is still there. The rules are
 * in docs/guides/testing.md, "Isolation between files".
 *
 * Nothing here imports the app or the agent packages at load time: the setup
 * runs before a file's `vi.mock` calls, and loading them first would defeat
 * those mocks in the `server:isolated` project.
 */
import { createHook } from "node:async_hooks";
import { afterAll, vi } from "vite-plus/test";
import { currentRuntimeSlot, setCurrentRuntimeSlot } from "./runtime-slot";

/**
 * Resources that outlive the code that made them: servers, sockets, child
 * processes, pipes, watchers, signal handlers and timers. Promises and the
 * like are not tracked (they cost a hook call each and hold nothing open).
 */
const TRACKED = new Set([
  "Timeout",
  "TCPSERVERWRAP",
  "TCPWRAP",
  "PIPESERVERWRAP",
  "PIPEWRAP",
  "PROCESSWRAP",
  "UDPWRAP",
  "FSEVENTWRAP",
  "STATWATCHER",
  "SIGNALWRAP",
  "TTYWRAP",
]);

const READABLE: Record<string, string> = {
  Timeout: "timer (setTimeout/setInterval) still due",
  TCPSERVERWRAP: "TCP server still listening",
  TCPWRAP: "TCP socket still open",
  PIPESERVERWRAP: "pipe server still listening",
  PIPEWRAP: "pipe still open",
  PROCESSWRAP: "child process still running",
  UDPWRAP: "UDP socket still open",
  FSEVENTWRAP: "file watcher still watching",
  STATWATCHER: "fs.watchFile watcher still watching",
  SIGNALWRAP: "signal listener still installed",
  TTYWRAP: "TTY still open",
};

/**
 * Every tracked resource opened while this file ran and not yet closed, by
 * async id. Ids are per resource, so a leak is never offset by something an
 * earlier file closed late (a count would be).
 */
type Opened = Map<number, { type: string; resource: WeakRef<object> }>;

function trackOpenedResources(): { open: Opened; stop(): void } {
  const open: Opened = new Map();
  const hook = createHook({
    init(id, type, _trigger, resource) {
      if (TRACKED.has(type)) open.set(id, { type, resource: new WeakRef(resource) });
    },
    destroy(id) {
      open.delete(id);
    },
  }).enable();
  return { open, stop: () => hook.disable() };
}

/**
 * An unref'd timer keeps nothing alive and, by the rule in testing.md, only
 * gives up on something (`AbortSignal.timeout` after a finished fetch): it
 * does not count. Loops that must stop are stopped by `stopAppServices`.
 */
function holdsOpen({ type, resource }: { type: string; resource: WeakRef<object> }): boolean {
  if (type !== "Timeout") return true;
  const timer = resource.deref() as { hasRef?: () => boolean } | undefined;
  return timer?.hasRef?.() ?? false;
}

function stillOpen(open: Opened): string[] {
  const counts = new Map<string, number>();
  for (const entry of open.values()) {
    if (holdsOpen(entry)) counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1);
  }
  return [...counts].map(([type, n]) => `${n} ${READABLE[type] ?? type}: close or clear it`);
}

/**
 * Globals a dependency installs on first import (tslib's helpers, pdf.js's
 * worker shim). They are the same in every file, so the first file to load
 * the dependency is not to blame.
 */
const INSTALLED_ON_IMPORT =
  /^(__[a-zA-Z]+|pdfjsLib|pdfjsWorker|_pdfjsTestingUtils|DOMMatrix|Path2D|ImageData)$/;

type Snapshot = {
  env: Record<string, string | undefined>;
  globals: Set<PropertyKey>;
};

function changedProcessState(before: Snapshot): string[] {
  const leaks: string[] = [];
  for (const key of new Set([...Object.keys(before.env), ...Object.keys(process.env)])) {
    if (before.env[key] !== process.env[key]) {
      leaks.push(`process.env.${key} changed: set it with vi.stubEnv, which the setup undoes`);
    }
  }
  for (const key of Reflect.ownKeys(globalThis)) {
    if (!before.globals.has(key) && !INSTALLED_ON_IMPORT.test(String(key))) {
      leaks.push(
        `globalThis.${String(key)} added: set it with vi.stubGlobal, which the setup undoes`,
      );
    }
  }
  return leaks;
}

/** Wait (real time, up to `ms`) for what a file's last hook closed to finish closing. */
async function settle(open: Opened, ms = 250): Promise<string[]> {
  const until = vi.getRealSystemTime() + ms;
  for (;;) {
    await new Promise((resolve) => setImmediate(resolve));
    const left = stillOpen(open);
    if (left.length === 0 || vi.getRealSystemTime() >= until) return left;
    await new Promise((resolve) => setTimeout(resolve, 10).unref());
  }
}

/**
 * Stop what the App root holds, as the entry's shutdown does
 * (apps/web/src/server/entry.node.ts), so a file's services cannot keep
 * working into the next file: agent runtimes (the App root's and the runtime
 * fixture's), MCP connections, browser and desktop sessions, sandbox SSH
 * connections and the Code hub; and forget what module services outside it
 * cached from the old database (notification settings, the job runner's
 * claims). Loaded here, after the file ran, so the
 * setup never loads them ahead of a file's `vi.mock`.
 */
async function stopAppServices(): Promise<void> {
  const { app } = await import("../../../apps/web/src/server/app-root");
  const { closeSandboxConnections } =
    await import("../../../apps/web/src/server/api/bots/sandbox-host");
  const { closeAllBrowserSessions } =
    await import("../../../packages/sandbox/src/browser-sessions");
  const { closeAllComputerSessions } =
    await import("../../../packages/sandbox/src/computer-sessions");
  const root = app();
  const slot = currentRuntimeSlot();
  setCurrentRuntimeSlot(undefined);
  // A fake runtime (useFakeRuntime, installAppForTests) has nothing to close.
  const runtimes = [root.runtime, slot?.kind === "real" ? slot.runtime : undefined];
  await Promise.allSettled([
    ...runtimes.map((runtime) =>
      typeof runtime?.close === "function" ? runtime.close() : undefined,
    ),
    typeof root.connectionManager?.close === "function"
      ? root.connectionManager.close()
      : undefined,
    closeAllBrowserSessions(),
    closeAllComputerSessions(),
  ]);
  closeSandboxConnections();
  if (typeof root.codeHub?.stop === "function") root.codeHub.stop();
  // Module services outside the App root that cache what the database held.
  const { notificationService } = await import("@groot/core/notification/notification.service");
  notificationService.forgetSettings();
  const { jobRunner } = await import("@groot/jobs/server");
  jobRunner.reset();
}

/**
 * Snapshot the process now. After the file's own hooks: undo vitest's stubs,
 * spies and fake timers; close the agent runtimes the App root and the
 * runtime fixture hold; reset the App root; close the file's database; then
 * fail the file if it changed `process.env` or `globalThis` directly, or left
 * a server, socket, child process or timer open.
 */
export function guardFileIsolation(closeDatabase: () => void): void {
  // Node opens the stdio pipes on first use (stdin too, when a module
  // imports `node:process`): whichever file touched them first would own them.
  void process.stdin;
  void process.stdout;
  void process.stderr;
  const before: Snapshot = {
    env: { ...process.env },
    globals: new Set(Reflect.ownKeys(globalThis)),
  };
  const opened = trackOpenedResources();
  // Registered before the file's own hooks; vitest runs after-hooks in
  // reverse ("stack"), so this runs after them. Timeout 0: no hook timer of
  // its own to count (`settle` bounds the wait).
  afterAll(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    const leaks = changedProcessState(before);

    await stopAppServices();
    const { resetAppForTests } = await import("../../../apps/web/src/server/app-root");
    resetAppForTests();
    closeDatabase();
    leaks.push(...(await settle(opened.open)));
    opened.stop();

    if (leaks.length > 0) {
      throw new Error(
        `This file left state behind for the next file in its worker:\n  ${leaks.join("\n  ")}\n` +
          "See docs/guides/testing.md, Isolation between files.",
      );
    }
  }, 0);
}
