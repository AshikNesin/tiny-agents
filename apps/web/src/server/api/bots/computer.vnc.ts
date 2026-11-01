/**
 * VNC bridges for the bot computer (issue #108): the shared desktop bridge
 * (`desktop.vnc.ts`) pointed at the RFB server of a desktop on the sandbox
 * VM, on two paths:
 * - `/bots/:id/computer/vnc`, the chat's Computer panel, after
 *   `POST /bots/:id/computer/vnc-ticket`;
 * - `/computer/:profile/vnc`, the Computer page, after
 *   `POST /computer/:profile/vnc-ticket`.
 * Each path has its own ticket store, so a ticket only opens the path it was
 * minted for.
 */
import type { IncomingMessage, Server } from "node:http";
import { getComputerSessions } from "./computer.sessions";
import { attachVncBridge, type VncTarget } from "./desktop.vnc";
import { createTicketStore } from "../ws/upgrade";

const BOT_PATH = /^\/api\/v1\/bots\/([^/]+)\/computer\/vnc$/;
const PAGE_PATH = /^\/api\/v1\/computer\/([^/]+)\/vnc$/;

interface BotTicket {
  userId: number;
  botId: string;
  /** The bot's desktop profile. */
  profile: string;
}

interface PageTicket {
  userId: number;
  profile: string;
}

const botTickets = createTicketStore<BotTicket>();
const pageTickets = createTicketStore<PageTicket>();

export function issueComputerVncTicket(input: BotTicket): string {
  return botTickets.issue(input);
}

/** A ticket for the Computer page's viewer of one desktop. */
export function issueDesktopVncTicket(input: PageTicket): string {
  return pageTickets.issue(input);
}

export function resetComputerVncTicketsForTests(): void {
  botTickets.reset();
  pageTickets.reset();
}

/** The live desktop of a profile, as the bridge streams it. */
function desktopTarget(profile: string): VncTarget | undefined {
  const vnc = getComputerSessions()?.get(profile)?.desktop.vnc;
  if (!vnc) return undefined;
  return {
    openStream: () => vnc.openStream(),
    // An open viewer keeps the desktop from idling out.
    touch() {
      const live = getComputerSessions()?.get(profile);
      if (live) live.lastActivity = Date.now();
    },
  };
}

/** Bridge both computer paths; returns a closer for graceful shutdown. */
export function attachComputerVnc(
  httpServer: Server,
  options: { isOriginAllowed?: (req: IncomingMessage) => boolean } = {},
): { close(): void } {
  const bots = attachVncBridge(httpServer, {
    path: BOT_PATH,
    tickets: botTickets,
    scope: (ticket) => ticket.botId,
    kind: "computer",
    isOriginAllowed: options.isOriginAllowed,
    resolve: (ticket) => desktopTarget(ticket.profile),
  });
  const page = attachVncBridge(httpServer, {
    path: PAGE_PATH,
    tickets: pageTickets,
    scope: (ticket) => ticket.profile,
    kind: "computer",
    isOriginAllowed: options.isOriginAllowed,
    resolve: (ticket) => desktopTarget(ticket.profile),
  });
  return {
    close() {
      bots.close();
      page.close();
    },
  };
}
