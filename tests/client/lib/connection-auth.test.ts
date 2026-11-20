import { describe, expect, it, vi } from "vite-plus/test";
import { createConnectionAuth, type AuthPopup } from "@/lib/connection-auth";

function fakePorts(options: { blocked?: boolean } = {}) {
  const popups: (AuthPopup & { url?: string; closed: boolean })[] = [];
  const listeners = new Set<(data: unknown) => void>();
  let answer!: (url: { authorizationUrl?: string }) => void;
  let fail!: (error: unknown) => void;
  const authorize = vi.fn(
    () =>
      new Promise<{ authorizationUrl?: string }>((resolve, reject) => {
        answer = resolve;
        fail = reject;
      }),
  );
  return {
    popups,
    authorize,
    answer: (url?: string) => answer({ authorizationUrl: url }),
    fail: (error: unknown) => fail(error),
    post: (data: unknown) => {
      for (const listener of listeners) listener(data);
    },
    ports: {
      openPopup: () => {
        if (options.blocked) return null;
        const popup = {
          url: undefined as string | undefined,
          closed: false,
          navigate(url: string) {
            this.url = url;
          },
          close() {
            this.closed = true;
          },
        };
        popups.push(popup);
        return popup;
      },
      authorize,
      onMessage: (listener: (data: unknown) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
}

describe("connection auth", () => {
  it("opens the popup first, then points it at the authorization page", async () => {
    const fake = fakePorts();
    const auth = createConnectionAuth(fake.ports);
    const outcome = auth.signIn("c1");
    expect(fake.popups).toHaveLength(1);
    expect(fake.authorize).toHaveBeenCalledWith("c1");
    fake.answer("https://idp.example/authorize?x=1");
    expect(await outcome).toEqual({ status: "opened" });
    expect(fake.popups[0]!.url).toBe("https://idp.example/authorize?x=1");
    expect(fake.popups[0]!.closed).toBe(false);
  });

  it("waits for a connection still being created, so the popup belongs to the click", async () => {
    const fake = fakePorts();
    const auth = createConnectionAuth(fake.ports);
    let created!: (id: string) => void;
    const outcome = auth.signIn(new Promise<string>((resolve) => (created = resolve)));
    expect(fake.popups).toHaveLength(1);
    expect(fake.authorize).not.toHaveBeenCalled();
    created("c9");
    await vi.waitFor(() => expect(fake.authorize).toHaveBeenCalledWith("c9"));
    fake.answer("https://idp.example/a");
    expect(await outcome).toEqual({ status: "opened" });
  });

  it("reports a blocked popup once the sign-in page is known", async () => {
    const fake = fakePorts({ blocked: true });
    const outcome = createConnectionAuth(fake.ports).signIn("c1");
    fake.answer("https://idp.example/a");
    expect(await outcome).toEqual({ status: "blocked" });
  });

  it("closes the popup when there is no sign-in URL or the request fails", async () => {
    const noUrl = fakePorts();
    const first = createConnectionAuth(noUrl.ports).signIn("c1");
    noUrl.answer(undefined);
    expect(await first).toEqual({ status: "no_url" });
    expect(noUrl.popups[0]!.closed).toBe(true);

    const failing = fakePorts();
    const second = createConnectionAuth(failing.ports).signIn("c1");
    const error = new Error("boom");
    failing.fail(error);
    expect(await second).toEqual({ status: "failed", error });
    expect(failing.popups[0]!.closed).toBe(true);
  });

  it("hands a completion to the listener for its connection, or for any", () => {
    const fake = fakePorts();
    const auth = createConnectionAuth(fake.ports);
    const forC1 = vi.fn();
    const forAny = vi.fn();
    const offC1 = auth.onCompleted("c1", forC1);
    auth.onCompleted(undefined, forAny);

    fake.post({ type: "tiny-agents:oauth", id: "c2" });
    fake.post({ type: "something-else", id: "c1" });
    fake.post(null);
    expect(forC1).not.toHaveBeenCalled();
    expect(forAny).toHaveBeenCalledTimes(1);

    fake.post({ type: "tiny-agents:oauth", id: "c1", error: "denied" });
    expect(forC1).toHaveBeenCalledWith({ id: "c1", error: "denied" });

    offC1();
    fake.post({ type: "tiny-agents:oauth", id: "c1" });
    expect(forC1).toHaveBeenCalledTimes(1);
    expect(forAny).toHaveBeenCalledTimes(3);
  });
});
