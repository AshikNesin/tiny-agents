/**
 * The Pushover channel against a stubbed fetch: status mapping (200, 4xx
 * with errors[], 429, 5xx, timeout), validation, quota, and that missing
 * credentials never reach the network.
 */
import { describe, expect, it, vi } from "vite-plus/test";
import { createPushoverChannel, PUSHOVER_API } from "@groot/core/notification/pushover";

const TOKEN = "app-token-for-tests";
const USER = "user-key-for-tests";

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers }));
}

function channel(fetch: typeof globalThis.fetch, creds = { token: TOKEN, user: USER }) {
  return createPushoverChannel({
    token: () => creds.token,
    user: () => creds.user,
    fetch,
  });
}

const message = {
  title: "Ops needs approval",
  message: "Wants to run run_command.",
  priority: 1 as const,
};

describe("Pushover channel", () => {
  it("is unconfigured without both credentials and never fetches", async () => {
    const fetch = respond(200, { status: 1 });
    const ch = channel(fetch, { token: TOKEN, user: "" });
    expect(ch.configured()).toBe(false);
    const result = await ch.send(message);
    expect(result).toMatchObject({ ok: false, retryable: false, reason: "invalid_credentials" });
    expect(await ch.quota()).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts a form-encoded message and returns the request id and quota", async () => {
    const fetch = respond(
      200,
      { status: 1, request: "req-1" },
      {
        "X-Limit-App-Limit": "10000",
        "X-Limit-App-Remaining": "9990",
        "X-Limit-App-Reset": "1793500000",
      },
    );
    const result = await channel(fetch).send({
      ...message,
      url: "https://app.example/chats/b1",
      urlTitle: "Open approval",
      ttlSeconds: 600,
      device: "phone",
    });
    expect(result).toEqual({
      ok: true,
      providerId: "req-1",
      quota: { limit: 10000, remaining: 9990, reset: new Date(1793500000 * 1000) },
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${PUSHOVER_API}/messages.json`);
    expect(init.method).toBe("POST");
    const form = init.body as URLSearchParams;
    expect(Object.fromEntries(form)).toEqual({
      token: TOKEN,
      user: USER,
      title: "Ops needs approval",
      message: "Wants to run run_command.",
      priority: "1",
      url: "https://app.example/chats/b1",
      url_title: "Open approval",
      ttl: "600",
      device: "phone",
    });
    // Plain text only: never html=1.
    expect(form.has("html")).toBe(false);
  });

  it("maps a 4xx naming the token to invalid credentials, without retry", async () => {
    const fetch = respond(400, {
      token: "invalid",
      errors: ["application token is invalid"],
      status: 0,
    });
    expect(await channel(fetch).send(message)).toEqual({
      ok: false,
      retryable: false,
      reason: "invalid_credentials",
      detail: "application token is invalid",
    });
  });

  it("maps other 4xx to invalid input", async () => {
    const fetch = respond(400, {
      message: "invalid",
      errors: ["message cannot be blank"],
      status: 0,
    });
    expect(await channel(fetch).send(message)).toMatchObject({
      ok: false,
      retryable: false,
      reason: "invalid_input",
      detail: "message cannot be blank",
    });
  });

  it("maps 429 to over quota with the reset time", async () => {
    const fetch = respond(
      429,
      { status: 0, errors: ["quota exceeded"] },
      {
        "X-Limit-App-Remaining": "0",
        "X-Limit-App-Reset": "1793500000",
      },
    );
    expect(await channel(fetch).send(message)).toEqual({
      ok: false,
      retryable: false,
      reason: "over_quota",
      detail: "quota exceeded",
      resetAt: new Date(1793500000 * 1000),
    });
  });

  it("maps 5xx, network errors and timeouts to retryable transient failures", async () => {
    expect(await channel(respond(503, {})).send(message)).toMatchObject({
      ok: false,
      retryable: true,
      reason: "transient",
    });
    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await channel(offline).send(message)).toMatchObject({
      retryable: true,
      reason: "transient",
    });
    const hung = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const slow = createPushoverChannel({
      token: () => TOKEN,
      user: () => USER,
      fetch: hung as unknown as typeof globalThis.fetch,
      timeoutMs: 20,
    });
    expect(await slow.send(message)).toMatchObject({ retryable: true, reason: "transient" });
  });

  it("validates credentials and lists devices", async () => {
    const ok = respond(200, { status: 1, devices: ["iphone", "desk"], licenses: ["iOS"] });
    expect(await channel(ok).validate("iphone")).toEqual({ ok: true, devices: ["iphone", "desk"] });
    const [, init] = ok.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.body as URLSearchParams).get("device")).toBe("iphone");

    const bad = respond(400, { user: "invalid", errors: ["user key is invalid"], status: 0 });
    expect(await channel(bad).validate()).toEqual({
      ok: false,
      reason: "invalid_credentials",
      detail: "user key is invalid",
    });
    expect(await channel(respond(500, {})).validate()).toMatchObject({
      ok: false,
      reason: "transient",
    });
  });

  it("reads the monthly quota", async () => {
    const fetch = respond(200, { status: 1, limit: 10000, remaining: 42, reset: 1793500000 });
    expect(await channel(fetch).quota()).toEqual({
      limit: 10000,
      remaining: 42,
      reset: new Date(1793500000 * 1000),
    });
  });
});
