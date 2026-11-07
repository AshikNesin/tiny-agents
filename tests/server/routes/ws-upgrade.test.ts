/**
 * The ticket store and Origin policy shared by the VNC and terminal bridges.
 */
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  createTicketStore,
  isOriginAllowed,
  TICKET_TTL_MS,
} from "../../../apps/web/src/server/api/ws/upgrade";
import { authToken } from "../fixtures";

// Tickets are held as live access, which needs their accounts to exist.
await authToken("ticket-owner-1@example.com", 1);
await authToken("ticket-owner-2@example.com", 2);

describe("ticket store", () => {
  afterEach(() => vi.useRealTimers());

  it("redeems once, only for a matching target, and never again", () => {
    const store = createTicketStore<{ userId: number; target: string }>();
    const ticket = store.issue({ userId: 1, target: "a" });
    expect(store.redeem(ticket, (t) => t.target === "a")).toEqual({ userId: 1, target: "a" });
    expect(store.redeem(ticket, (t) => t.target === "a")).toBeUndefined();
  });

  it("is spent by a mismatched attempt", () => {
    const store = createTicketStore<{ userId: number; target: string }>();
    const ticket = store.issue({ userId: 1, target: "a" });
    expect(store.redeem(ticket, (t) => t.target === "b")).toBeUndefined();
    expect(store.redeem(ticket, (t) => t.target === "a")).toBeUndefined();
  });

  it("expires after the TTL", () => {
    vi.useFakeTimers();
    const store = createTicketStore<{ userId: number }>();
    const ticket = store.issue({ userId: 1 });
    vi.advanceTimersByTime(TICKET_TTL_MS + 1);
    expect(store.redeem(ticket, () => true)).toBeUndefined();
  });

  it("caps live tickets per user with 429, counting only unexpired ones", () => {
    vi.useFakeTimers();
    const store = createTicketStore<{ userId: number }>({ perUserLimit: 2 });
    store.issue({ userId: 1 });
    store.issue({ userId: 1 });
    expect(() => store.issue({ userId: 1 })).toThrow(/Too many/);
    // Another user is unaffected; expiry frees the cap.
    expect(() => store.issue({ userId: 2 })).not.toThrow();
    vi.advanceTimersByTime(TICKET_TTL_MS + 1);
    expect(() => store.issue({ userId: 1 })).not.toThrow();
  });

  it("is unguessable and unique", () => {
    const store = createTicketStore<{ userId: number }>();
    const tickets = new Set(Array.from({ length: 50 }, () => store.issue({ userId: 1 })));
    expect(tickets.size).toBe(50);
    for (const ticket of tickets) expect(ticket).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});

describe("isOriginAllowed", () => {
  const req = (headers: Record<string, string>) => ({ headers }) as never;

  it("allows no Origin (non-browser), the same host and a forwarded host", () => {
    expect(isOriginAllowed(req({ host: "app.test" }))).toBe(true);
    expect(isOriginAllowed(req({ host: "app.test", origin: "https://app.test" }))).toBe(true);
    expect(
      isOriginAllowed(
        req({ host: "internal", "x-forwarded-host": "app.test", origin: "https://app.test" }),
      ),
    ).toBe(true);
  });

  it("refuses a foreign or malformed Origin", () => {
    expect(isOriginAllowed(req({ host: "app.test", origin: "https://evil.test" }))).toBe(false);
    expect(isOriginAllowed(req({ host: "app.test", origin: "not a url" }))).toBe(false);
  });
});
