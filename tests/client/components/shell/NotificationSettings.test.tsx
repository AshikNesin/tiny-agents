/**
 * @vitest-environment jsdom
 *
 * Settings → Notifications: one place notifications go. The owner picks the
 * phone app, Pushover or Off; only the chosen one's details show, and the
 * choice is saved as `deliverTo`.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { GrootUIProvider } from "@groot/ui/provider";
import { createShellQueryClient, ShellQueryProvider } from "@groot/shell/lib/query-client";
import { NotificationSettings } from "@groot/shell/components/NotificationSettings";

/** A fake `/api/v1/notifications/*` holding one settings value; returns what was saved. */
function serve(deliverTo: string) {
  const saved: Record<string, unknown>[] = [];
  let settings: Record<string, unknown> = {
    deliverTo,
    events: {},
    quietHours: {
      enabled: false,
      start: "22:00",
      end: "07:00",
      timezone: "Asia/Kolkata",
      urgentBypass: false,
    },
    device: "",
    longRunMinutes: 5,
    coalesceSeconds: 30,
    reminderMinutes: 15,
    throttle: { perHour: 30, perBotPerMinute: 5 },
  };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const path = url.replace("/api/v1", "").split("?")[0];
    const method = init.method ?? "GET";
    const ok = (data: unknown) =>
      new Response(JSON.stringify({ success: true, data }), { status: 200 });
    if (path === "/notifications/settings") {
      if (method === "PUT") {
        settings = JSON.parse(String(init.body)) as Record<string, unknown>;
        saved.push(settings);
      }
      return ok({ settings, events: [] });
    }
    if (path === "/notifications/status") {
      return ok({ channel: "pushover", state: "connected", requiredEnv: [], devices: ["pixel"] });
    }
    if (path === "/notifications/log") return ok([]);
    return new Response(null, { status: 404 });
  });
  return saved;
}

function renderPage() {
  return render(
    <ShellQueryProvider client={createShellQueryClient({ queries: { retry: false } })}>
      <GrootUIProvider>
        <NotificationSettings
          destinations={[{ id: "webpush", label: "Phone app", details: <p>Pixel 7a</p> }]}
        />
      </GrootUIProvider>
    </ShellQueryProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NotificationSettings", () => {
  it("shows only the chosen channel, and switching saves the one choice", async () => {
    const saved = serve("webpush");
    renderPage();

    const phone = await screen.findByRole("radio", { name: "Phone app" });
    expect(phone.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Pixel 7a")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Send test/ })).toBeNull();

    await userEvent.click(screen.getByRole("radio", { name: "Pushover" }));
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "Pushover" }).getAttribute("aria-checked")).toBe(
        "true",
      ),
    );
    expect(saved.map((value) => value.deliverTo)).toEqual(["pushover"]);
    expect(screen.queryByText("Pixel 7a")).toBeNull();
    expect(await screen.findByRole("button", { name: /Send test/ })).toBeTruthy();
  });

  it("turned off, says nothing is sent and hides what to send", async () => {
    serve("off");
    renderPage();
    expect(await screen.findByText("Nothing is sent. Bots work the same.")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Off" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText("What to send")).toBeNull();
  });
});
