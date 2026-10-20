/**
 * @vitest-environment jsdom
 *
 * BrowserPanel (issue #24): live-view docking, takeover/release, the masked
 * secret field, and the never-hold-a-secret rule (keystrokes go to the
 * input route, the input element holds at most the display string).
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { BrowserPanel } from "@/components/BrowserPanel";
import { botsApi, type Bot } from "@/lib/bots-api";
import type { BrowserStatus } from "@/lib/bots-api";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const bot: Bot = {
  id: "b1",
  name: "Surfer",
  description: "",
  systemPrompt: "",
  modelId: "m",
  conversationId: "1",
  lastReadAt: null,
  lastActivityAt: "",
  lastMessagePreview: null,
  approvals: 0,
  pinnedAt: null,
  unread: false,
  replying: false,
} as unknown as Bot;

const status = (s: Partial<BrowserStatus>): BrowserStatus => ({
  active: true,
  url: "https://example.com/",
  driver: "agent",
  ...s,
});

function mockApi(s: BrowserStatus) {
  const input = vi.fn().mockResolvedValue(undefined);
  const driver = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(botsApi, "browserStatus").mockResolvedValue(s);
  vi.spyOn(botsApi, "browserInput").mockImplementation(input);
  vi.spyOn(botsApi, "browserDriver").mockImplementation(driver);
  return { input, driver };
}

describe("BrowserPanel", () => {
  it("shows the viewport image and driver badge while the bot drives", async () => {
    mockApi(status({}));
    render(<BrowserPanel bot={bot} onClose={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByTestId("browser-url").textContent).toBe("https://example.com/"),
    );
    const img = screen.getByAltText("bot browser viewport") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/api/v1/bots/b1/browser/live");
    expect(screen.getByTestId("browser-driver").textContent).toContain("Surfer drives");
    expect(screen.queryByTestId("browser-secret")).not.toBeInTheDocument();
  });

  it("takeover flips to the masked field; typed characters go straight to the input route", async () => {
    const { driver, input } = mockApi(status({}));
    render(<BrowserPanel bot={bot} onClose={vi.fn()} />);
    await waitFor(() => screen.getByTestId("browser-takeover"));
    fireEvent.click(screen.getByTestId("browser-takeover"));
    await waitFor(() => expect(driver).toHaveBeenCalledWith("b1", "human"));
    const field = await screen.findByTestId("browser-secret");
    // Secret-protection regressions: masked field, printable keys never
    // reach the DOM input (they go to the page only).
    expect(field).toHaveAttribute("type", "password");
    const printable = new KeyboardEvent("keydown", { key: "s", bubbles: true, cancelable: true });
    fireEvent(field, printable);
    expect(printable.defaultPrevented).toBe(true);
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(input).toHaveBeenCalledTimes(2));
    expect(input).toHaveBeenNthCalledWith(1, "b1", { kind: "key", key: "s", text: "s" });
    expect(input).toHaveBeenNthCalledWith(2, "b1", { kind: "key", key: "Enter" });
  });

  it("release hands the wheel back", async () => {
    const { driver } = mockApi(status({ driver: "human" }));
    render(<BrowserPanel bot={bot} onClose={vi.fn()} />);
    const release = await screen.findByTestId("browser-release");
    fireEvent.click(release);
    await waitFor(() => expect(driver).toHaveBeenCalledWith("b1", "agent"));
  });

  it("shows the waiting state before any session exists", async () => {
    mockApi(status({ active: false, url: null, driver: null }));
    render(<BrowserPanel bot={bot} onClose={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/opens when Surfer first uses it/i)).toBeInTheDocument(),
    );
    expect(screen.getByTestId("browser-takeover")).toBeDisabled();
  });
});
