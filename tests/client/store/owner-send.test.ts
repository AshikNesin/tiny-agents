/**
 * Owner send (store/owner-send.ts): one request id per Echo, reused by every
 * attempt, so an offline resend can never place the message twice; a
 * refusal withdraws the Echo and hands the draft back.
 */
import { describe, expect, it, vi } from "vite-plus/test";
import { ApiError } from "@groot/shell/lib/api";

vi.mock("../../../apps/web/src/client/lib/bots-api", () => ({ botsApi: {} }));

import {
  createOwnerSend,
  type OwnerSendPorts,
  type OwnerSubmission,
} from "../../../apps/web/src/client/store/owner-send";
import type { ChatEvent } from "../../../apps/web/src/client/store/bots";

const SUBMISSION: OwnerSubmission = {
  body: "ok",
  attachments: [],
  mentions: [],
  whenBusy: "steer",
};

/** Fake ports: a scripted server, a switchable online signal, recorded events. */
function harness(responses: Array<() => Promise<unknown>>) {
  let online = true;
  const onlineListeners = new Set<() => void>();
  const events: ChatEvent[] = [];
  const errors: string[] = [];
  const send = vi.fn((..._args: unknown[]) => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected send");
    return next();
  });
  let ids = 0;
  const ports: OwnerSendPorts = {
    send: (...args) => send(...args),
    withdraw: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    isOnline: () => online,
    whenOnline: (listener) => {
      onlineListeners.add(listener);
      return () => onlineListeners.delete(listener);
    },
    applyChatEvent: (_botId, event) => events.push(event),
    notifyError: (message) => errors.push(message),
    newId: () => `req-${++ids}`,
    now: () => 1_000,
  };
  return {
    owner: createOwnerSend(ports),
    ports,
    send,
    events,
    errors,
    goOffline: () => {
      online = false;
    },
    goOnline: () => {
      online = true;
      for (const listener of onlineListeners) listener();
    },
  };
}

const lostAnswer = () => Promise.reject(new TypeError("Failed to fetch"));
const refused = () =>
  Promise.reject(
    new ApiError({
      status: 409,
      code: "CONFLICT",
      message: "The bot was deleted",
      url: "/bots/b1/messages",
      fromServer: true,
    }),
  );
const accepted = () => Promise.resolve({});

describe("owner send", () => {
  it("shows the Echo and sends it under the same request id", async () => {
    const h = harness([accepted]);
    await expect(h.owner.submit("b1", SUBMISSION)).resolves.toBe("sent");
    expect(h.events).toEqual([
      { type: "pending-add", message: { id: "req-1", text: "ok", createdAt: 1_000 } },
    ]);
    expect(h.send).toHaveBeenCalledWith("b1", "req-1", "ok", [], [], "steer");
  });

  it("resends an offline send with the same request id once back online (no duplicate)", async () => {
    const h = harness([lostAnswer, accepted]);
    h.goOffline();
    const outcome = h.owner.submit("b1", SUBMISSION);
    await vi.waitFor(() => expect(h.send).toHaveBeenCalledTimes(1));
    // Still offline: the Echo stays, nothing goes again yet.
    await Promise.resolve();
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.events.map((e) => e.type)).toEqual(["pending-add"]);

    h.goOnline();
    await expect(outcome).resolves.toBe("sent");
    expect(h.send).toHaveBeenCalledTimes(2);
    const ids = h.send.mock.calls.map((call) => call[1]);
    expect(ids).toEqual(["req-1", "req-1"]);
    expect(h.events.map((e) => e.type)).toEqual(["pending-add"]);
    expect(h.errors).toEqual([]);
  });

  it("keeps waiting while a resend finds the browser offline again", async () => {
    const h = harness([lostAnswer, accepted]);
    h.goOffline();
    const outcome = h.owner.submit("b1", SUBMISSION);
    await vi.waitFor(() => expect(h.send).toHaveBeenCalledTimes(1));
    // Back for a moment: the resend fails and the browser drops again.
    h.send.mockImplementationOnce(() => {
      h.goOffline();
      return lostAnswer();
    });
    h.goOnline();
    await vi.waitFor(() => expect(h.send).toHaveBeenCalledTimes(2));
    h.goOnline();
    await expect(outcome).resolves.toBe("sent");
    expect(new Set(h.send.mock.calls.map((call) => call[1]))).toEqual(new Set(["req-1"]));
  });

  it("withdraws the Echo and restores the draft when the server refuses", async () => {
    const h = harness([refused]);
    await expect(h.owner.submit("b1", SUBMISSION)).resolves.toBe("restored");
    expect(h.events.map((e) => e.type)).toEqual(["pending-add", "pending-remove"]);
    expect(h.events[1]).toEqual({ type: "pending-remove", id: "req-1" });
    expect(h.errors).toEqual(["The bot was deleted"]);
  });

  it("restores the draft when no answer came while online", async () => {
    const h = harness([lostAnswer]);
    await expect(h.owner.submit("b1", SUBMISSION)).resolves.toBe("restored");
    expect(h.events.map((e) => e.type)).toEqual(["pending-add", "pending-remove"]);
  });

  it("toasts and rethrows a refused stop; toasts a refused cancel", async () => {
    const h = harness([]);
    vi.mocked(h.ports.abort).mockRejectedValueOnce(new Error("nope"));
    await expect(h.owner.stop("b1")).rejects.toThrow("nope");
    vi.mocked(h.ports.withdraw).mockRejectedValueOnce(new Error("Already answered"));
    await h.owner.cancelQueued("b1", "req-9");
    expect(h.ports.withdraw).toHaveBeenCalledWith("b1", "req-9");
    expect(h.errors).toEqual(["Failed to stop the reply", "Already answered"]);
  });
});
