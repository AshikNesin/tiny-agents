import type { ToolExecutionResult } from "@earendil-works/pi-durable";
import type { WaitTracker } from "../waiting";
import type { VaultBroker } from "../vault";
import {
  DesktopGoneError,
  type ComputerSessions,
  type LiveComputer,
} from "@tiny-agents/sandbox/computer";
import { fail } from "./result";

const SHARED_COMPUTER_PROFILE = "shared";

export interface ComputerToolkitOptions {
  sessions?: ComputerSessions;
  resolveProfile?: (conversationId: number) => string | Promise<string>;
  setupHint?: string;
  vault?: VaultBroker;
  ownerWaits?: WaitTracker;
  settleMs?: number;
  takeoverWaitMs?: number;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function computerDesktop(options: ComputerToolkitOptions) {
  const sessions = options.sessions;
  const width = sessions?.width ?? 1280;
  const height = sessions?.height ?? 800;
  const settleMs = options.settleMs ?? 500;
  const profileOf = async (conversationId: number) =>
    (await options.resolveProfile?.(conversationId)) ?? SHARED_COMPUTER_PROFILE;

  const unavailable = () =>
    fail(options.setupHint ?? "The computer is not configured: set SANDBOX_HOST on the server.");

  const describe = (error: unknown): string => {
    if (error instanceof DesktopGoneError) {
      return "The desktop stopped (the VM may have restarted). Nothing was done; the next call starts a fresh desktop, so take a screenshot first.";
    }
    const message = error instanceof Error ? error.message : String(error);
    return /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH/.test(message)
      ? `Cannot reach the sandbox VM (${message}). Is it online and on the tailnet?`
      : message;
  };

  const dropIfGone = (profile: string, live: LiveComputer | undefined, error: unknown) => {
    if (live && error instanceof DesktopGoneError) sessions?.drop(profile, live.desktop);
  };

  const image = (shot: Buffer) =>
    ({ type: "image", data: shot.toString("base64"), mimeType: "image/jpeg" }) as const;

  const read = async <T>(
    conversationId: number,
    fn: (live: LiveComputer) => Promise<T>,
  ): Promise<T> => {
    const profile = await profileOf(conversationId);
    for (let attempt = 0; ; attempt++) {
      const live = await sessions!.readTurn(profile);
      try {
        return await fn(live);
      } catch (error) {
        dropIfGone(profile, live, error);
        if (!(error instanceof DesktopGoneError) || attempt > 0) throw error;
      }
    }
  };

  const act = async (
    conversationId: number,
    done: string,
    fn: (live: LiveComputer) => Promise<void>,
    shot = true,
  ): Promise<ToolExecutionResult> => {
    if (!sessions) return unavailable();
    const profile = await profileOf(conversationId);
    let live: LiveComputer | undefined;
    try {
      live = await sessions.actionTurn(profile);
      await fn(live);
    } catch (error) {
      dropIfGone(profile, live, error);
      return fail(describe(error));
    }
    if (!shot) return { output: [{ type: "text", text: done }] };
    await sleep(settleMs);
    if (live.driver === "human") {
      return { output: [{ type: "text", text: `${done} The owner has taken control since.` }] };
    }
    try {
      const screenshot = await live.desktop.screenshot();
      return {
        output: [{ type: "text", text: done }, image(screenshot)],
        details: { screenshot: true },
      };
    } catch (error) {
      dropIfGone(profile, live, error);
      return { output: [{ type: "text", text: `${done} (No screenshot: ${describe(error)})` }] };
    }
  };

  const guard = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      throw new Error(`(${x}, ${y}) is off the ${width}x${height} desktop.`);
    }
  };

  return {
    sessions,
    width,
    height,
    profileOf,
    unavailable,
    describe,
    dropIfGone,
    image,
    read,
    act,
    guard,
  };
}

export type ComputerDesktop = ReturnType<typeof computerDesktop>;
