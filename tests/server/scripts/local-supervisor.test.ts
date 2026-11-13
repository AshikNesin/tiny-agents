/**
 * `pnpm local`'s supervisor (scripts/lib/local-supervisor.ts): it builds a
 * new commit while the old server serves, swaps it in, keeps the old one
 * when the build fails, rolls back when the new one never comes up, and
 * restarts a crashed server.
 */
import { describe, expect, it } from "vite-plus/test";
import {
  Supervisor,
  type ServerHandle,
  type SupervisorPorts,
} from "../../../scripts/lib/local-supervisor";
import type { UpdateRelease } from "../../../apps/web/src/shared/local-updates";
import { until } from "../fixtures";

const OLD = "1".repeat(40);
const NEW = "2".repeat(40);

const release = (sha: string): UpdateRelease => ({
  sha,
  version: sha === OLD ? "1.0.0" : "1.1.0",
  subject: `commit ${sha[0]}`,
  committedAt: 0,
});

interface FakeServer extends ServerHandle {
  sha: string;
  sent: unknown[];
  stopped: boolean;
  crash(): void;
  /** A message from the server to the supervisor. */
  deliver(message: unknown): void;
}

function harness(options: { brokenBuild?: string; brokenStart?: string; auto?: boolean } = {}) {
  const built = new Set([OLD]);
  const servers: FakeServer[] = [];
  const saved: string[] = [];
  const pruned: string[][] = [];

  const launch = (sha: string): FakeServer => {
    let onMessage: (message: unknown) => void = () => {};
    let onExit: (code: number | null) => void = () => {};
    const server: FakeServer = {
      sha,
      sent: [],
      stopped: false,
      send: (message) => server.sent.push(message),
      onMessage: (listener) => {
        onMessage = listener;
      },
      onExit: (listener) => {
        onExit = listener;
      },
      stop: async () => {
        if (server.stopped) return;
        server.stopped = true;
        onExit(0);
      },
      crash: () => {
        server.stopped = true;
        onExit(1);
      },
      deliver: (message) => onMessage(message),
    };
    servers.push(server);
    if (sha === options.brokenStart) queueMicrotask(() => server.crash());
    else queueMicrotask(() => onMessage({ type: "server-ready" }));
    return server;
  };

  const ports: SupervisorPorts = {
    check: async () => ({
      latest: release(NEW),
      commits: [{ sha: NEW.slice(0, 7), subject: "commit 2" }],
      sandboxChanged: true,
    }),
    releaseInfo: async (sha) => release(sha),
    isBuilt: (sha) => built.has(sha),
    build: async (sha, onLine) => {
      onLine(`building ${sha.slice(0, 7)}`);
      if (sha === options.brokenBuild) throw new Error("pnpm run build exited 1");
      built.add(sha);
    },
    launch,
    probe: async () => false,
    saveCurrent: (sha) => saved.push(sha),
    prune: async (keep) => {
      pruned.push(keep);
    },
    log: () => {},
  };
  const supervisor = new Supervisor(ports, {
    track: "origin/main",
    auto: options.auto ?? false,
    readyTimeoutMs: 1000,
    probeIntervalMs: 10_000,
    crashBackoffMs: 5,
  });
  const live = () => servers.filter((server) => !server.stopped);
  return { supervisor, servers, live, saved, pruned };
}

describe("local supervisor", () => {
  it("builds the new commit, stops the old server only then, and keeps both releases", async () => {
    const { supervisor, servers, live, saved, pruned } = harness();
    await supervisor.start(OLD);
    await supervisor.check();
    expect(supervisor.status()).toMatchObject({ phase: "idle", sandboxChanged: true });
    expect(supervisor.updateAvailable()).toBe(true);

    await supervisor.apply();

    expect(servers.map((server) => server.sha)).toEqual([OLD, NEW]);
    expect(live().map((server) => server.sha)).toEqual([NEW]);
    expect(saved).toEqual([OLD, NEW]);
    expect(pruned).toEqual([[NEW, OLD]]);
    expect(supervisor.status()).toMatchObject({
      phase: "idle",
      current: { sha: NEW },
      commits: [],
      sandboxChanged: false,
      error: null,
    });
    // The new server hears the final status.
    expect(live()[0].sent.at(-1)).toMatchObject({
      type: "update-status",
      status: { phase: "idle", current: { sha: NEW } },
    });
  });

  it("keeps the running server when the build fails", async () => {
    const { supervisor, live } = harness({ brokenBuild: NEW });
    await supervisor.start(OLD);
    await supervisor.check();
    await supervisor.apply();

    expect(live().map((server) => server.sha)).toEqual([OLD]);
    expect(supervisor.status()).toMatchObject({
      phase: "failed",
      current: { sha: OLD },
      error: expect.stringContaining("pnpm run build exited 1"),
      log: ["building 2222222"],
    });
  });

  it("rolls back when the new release does not start", async () => {
    const { supervisor, servers, live, saved } = harness({ brokenStart: NEW });
    await supervisor.start(OLD);
    await supervisor.check();
    await supervisor.apply();

    expect(servers.map((server) => server.sha)).toEqual([OLD, NEW, OLD]);
    expect(live().map((server) => server.sha)).toEqual([OLD]);
    expect(saved).toEqual([OLD]);
    expect(supervisor.status()).toMatchObject({
      phase: "failed",
      current: { sha: OLD },
      error: expect.stringContaining("did not start"),
    });
  });

  it("updates on its own with --auto", async () => {
    const { supervisor, live } = harness({ auto: true });
    await supervisor.start(OLD);
    await supervisor.check();
    expect(live().map((server) => server.sha)).toEqual([NEW]);
  });

  it("acts on the server's check and apply requests", async () => {
    const { supervisor, servers, live } = harness();
    await supervisor.start(OLD);
    servers[0].deliver({ type: "update-check" });
    await until(() => supervisor.updateAvailable(), "the check");
    servers[0].deliver({ type: "update-apply" });
    await until(() => live()[0]?.sha === NEW && supervisor.status().phase === "idle", "the update");
  });

  it("restarts a server that crashed", async () => {
    const { supervisor, servers, live } = harness();
    await supervisor.start(OLD);
    servers[0].crash();
    await until(() => live().length === 1, "the restart");
    expect(servers.map((server) => server.sha)).toEqual([OLD, OLD]);
    await supervisor.shutdown();
    expect(live()).toEqual([]);
  });
});
