import { createHook } from "node:async_hooks";
import { afterAll, vi } from "vite-plus/test";
import { currentRuntimeSlot, setCurrentRuntimeSlot } from "./runtime-slot";

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

async function settle(open: Opened, ms = 250): Promise<string[]> {
  const until = vi.getRealSystemTime() + ms;
  for (;;) {
    await new Promise((resolve) => setImmediate(resolve));
    const left = stillOpen(open);
    if (left.length === 0 || vi.getRealSystemTime() >= until) return left;
    await new Promise((resolve) => setTimeout(resolve, 10).unref());
  }
}

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
  const { notificationService } = await import("@groot/core/notification/notification.service");
  notificationService.forgetSettings();
  const { jobRunner } = await import("@groot/jobs/server");
  await jobRunner.stop();
  jobRunner.reset();
}

export function guardFileIsolation(closeDatabase: () => void): void {
  void process.stdin;
  void process.stdout;
  void process.stderr;
  const before: Snapshot = {
    env: { ...process.env },
    globals: new Set(Reflect.ownKeys(globalThis)),
  };
  const opened = trackOpenedResources();
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
