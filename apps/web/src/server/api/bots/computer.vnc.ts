/**
 * VNC bridge for the bot computer (issue #108): the shared desktop bridge
 * (`desktop.vnc.ts`) pointed at the RFB server of the bot's desktop on the
 * sandbox VM. The viewer first calls the authenticated
 * `POST /bots/:id/computer/vnc-ticket` and presents the ticket here.
 */
import type { IncomingMessage, Server } from "node:http";
import { getComputerSessions } from "./computer.sessions";
import { attachVncBridge } from "./desktop.vnc";
import { createTicketStore } from "../ws/upgrade";

const PATH = /^\/api\/v1\/bots\/([^/]+)\/computer\/vnc$/;

interface Ticket {
  userId: number;
  botId: string;
  /** The bot's desktop profile. */
  profile: string;
}

const tickets = createTicketStore<Ticket>();

export function issueComputerVncTicket(input: Ticket): string {
  return tickets.issue(input);
}

export function resetComputerVncTicketsForTests(): void {
  tickets.reset();
}

/** Bridge `/bots/:id/computer/vnc`; returns a closer for graceful shutdown. */
export function attachComputerVnc(
  httpServer: Server,
  options: { isOriginAllowed?: (req: IncomingMessage) => boolean } = {},
): { close(): void } {
  return attachVncBridge(httpServer, {
    path: PATH,
    tickets,
    kind: "computer",
    isOriginAllowed: options.isOriginAllowed,
    resolve(ticket) {
      const vnc = getComputerSessions()?.get(ticket.profile)?.desktop.vnc;
      if (!vnc) return undefined;
      return {
        openStream: () => vnc.openStream(),
        touch() {
          const live = getComputerSessions()?.get(ticket.profile);
          if (live) live.lastActivity = Date.now();
        },
      };
    },
  });
}
