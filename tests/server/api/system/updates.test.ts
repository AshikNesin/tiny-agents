/**
 * Local self-updates, the server's half (docs/guides/local-updates.md): the
 * owner reads the status the `pnpm local` supervisor sends and asks it to
 * check or update; a server nothing supervises says so.
 */
import { afterEach, describe, expect, it } from "vite-plus/test";
import { matchGuestRoute } from "../../../../apps/web/src/server/api/people/guest.guard";
import {
  startUpdates,
  type SupervisorChannel,
} from "../../../../apps/web/src/server/api/system/updates.service";
import type {
  ServerMessage,
  UpdateStatus,
  UpdateView,
} from "../../../../apps/web/src/shared/local-updates";
import { api, createTestApp, signIn } from "../../helpers";

const app = createTestApp();

function fakeSupervisor() {
  const sent: ServerMessage[] = [];
  let listener: (message: unknown) => void = () => {};
  const channel: SupervisorChannel = {
    send: (message) => sent.push(message),
    onMessage: (next) => {
      listener = next;
      return () => {
        listener = () => {};
      };
    },
  };
  return { channel, sent, deliver: (message: unknown) => listener(message) };
}

const STATUS: UpdateStatus = {
  track: "origin/main",
  current: { sha: "a".repeat(40), version: "1.2.1", subject: "old", committedAt: 0 },
  latest: { sha: "b".repeat(40), version: "1.3.0", subject: "new", committedAt: 1 },
  commits: [{ sha: "bbbbbbb", subject: "new" }],
  sandboxChanged: false,
  phase: "idle",
  error: null,
  log: [],
  auto: false,
  lastCheckedAt: null,
};

let stop = () => {};
afterEach(() => stop());

describe("local updates API", () => {
  it("reports an unsupervised server and refuses to update it", async () => {
    stop = startUpdates(undefined);
    const { token } = await signIn(app);

    const view = await api<UpdateView>(app, "/api/v1/system/update", { token });
    expect(view.body.data).toEqual({ supervised: false, status: null });

    const apply = await api(app, "/api/v1/system/update/apply", { method: "POST", token });
    expect(apply.status).toBe(409);
  });

  it("says ready, shows the supervisor's status and relays check and apply", async () => {
    const supervisor = fakeSupervisor();
    stop = startUpdates(supervisor.channel);
    expect(supervisor.sent).toEqual([{ type: "server-ready" }]);

    supervisor.deliver({ type: "update-status", status: STATUS });
    supervisor.deliver({ type: "something-else" });
    const { token } = await signIn(app);
    const view = await api<UpdateView>(app, "/api/v1/system/update", { token });
    expect(view.body.data).toEqual({ supervised: true, status: STATUS });

    expect((await api(app, "/api/v1/system/update/check", { method: "POST", token })).status).toBe(
      202,
    );
    expect((await api(app, "/api/v1/system/update/apply", { method: "POST", token })).status).toBe(
      202,
    );
    expect(supervisor.sent.slice(1)).toEqual([{ type: "update-check" }, { type: "update-apply" }]);
  });

  it("is the owner's alone", () => {
    expect(matchGuestRoute("GET", "/system/update")).toBeUndefined();
    expect(matchGuestRoute("POST", "/system/update/apply")).toBeUndefined();
  });
});
