export type PeerEnvelope =
  | { kind: "reply"; name: string; text: string }
  | { kind: "message"; name: string; text: string }
  | { kind: "mention"; hostName: string; text: string };

const PATTERNS: { kind: PeerEnvelope["kind"]; pattern: RegExp }[] = [
  { kind: "reply", pattern: /^\*{0,2}\s*reply from (?<name>.+?)\s*:\*{0,2}\s+(?<text>[\s\S]+)$/i },
  {
    kind: "message",
    pattern: /^\*{0,2}\s*message from (?<name>.+?)\s*\(bot\)\s*:\*{0,2}\s+(?<text>[\s\S]+)$/i,
  },
  {
    kind: "mention",
    pattern: /^\[\s*from the owner,\s*in (?<host>.+?)\s*'s chat\s*\]\s*(?<text>[\s\S]+)$/i,
  },
];

export function parsePeerEnvelope(text: string): PeerEnvelope | null {
  for (const { kind, pattern } of PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const groups = match.groups ?? {};
    const body = (groups.text ?? "").trim();
    if (!body) return null;
    if (kind === "mention") {
      return { kind, hostName: (groups.host ?? "").trim(), text: body };
    }
    return { kind, name: (groups.name ?? "").trim(), text: body };
  }
  return null;
}

export function stripPeerEnvelope(text: string): string {
  return parsePeerEnvelope(text)?.text ?? text;
}
