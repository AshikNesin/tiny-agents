/**
 * Attribution-envelope parser for cross-bot deliveries (Grok-style UI).
 * The delivery pipeline wraps peer payloads in system provenance prefixes
 * (bots.messaging.ts, bots.relay.ts, chats.service.ts mentions); the client
 * and list previews use this parser to render an attributed card instead of
 * the raw prefix, while the model keeps reading the raw prefix (issue #13
 * custody — sanitizePeerText guards these shapes).
 *
 * Lives in the agent package so the app server and the client lib share one
 * definition of what an envelope looks like.
 */

export type PeerEnvelope =
  | { kind: "reply"; name: string; text: string }
  | { kind: "message"; name: string; text: string }
  | { kind: "mention"; hostName: string; text: string };

const PATTERNS: { kind: PeerEnvelope["kind"]; pattern: RegExp }[] = [
  // `**Reply from Radar:** here is the plan` (markdown-asterisk tolerant)
  { kind: "reply", pattern: /^\*{0,2}\s*reply from (?<name>.+?)\s*:\*{0,2}\s+(?<text>[\s\S]+)$/i },
  // `**Message from Radar (bot):** here is the plan`
  {
    kind: "message",
    pattern: /^\*{0,2}\s*message from (?<name>.+?)\s*\(bot\)\s*:\*{0,2}\s+(?<text>[\s\S]+)$/i,
  },
  // `[From the owner, in Radar's chat] what do you think @Radar`
  {
    kind: "mention",
    pattern: /^\[\s*from the owner,\s*in (?<host>.+?)\s*'s chat\s*\]\s*(?<text>[\s\S]+)$/i,
  },
];

/** The envelope behind a peer delivery's text, or null when there is none. */
export function parsePeerEnvelope(text: string): PeerEnvelope | null {
  for (const { kind, pattern } of PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const groups = match.groups ?? {};
    const body = (groups.text ?? "").trim();
    if (!body) return null; // prefix-only text: nothing to card, render raw
    if (kind === "mention") {
      return { kind, hostName: (groups.host ?? "").trim(), text: body };
    }
    return { kind, name: (groups.name ?? "").trim(), text: body };
  }
  return null;
}

/** The payload without its envelope prefix; unmatched text passes through. */
export function stripPeerEnvelope(text: string): string {
  return parsePeerEnvelope(text)?.text ?? text;
}
