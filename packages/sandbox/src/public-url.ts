/**
 * URL and address guards shared by the web toolkit and the browser: no
 * pi-durable here, so the `/browser` and `/claude-worker` subpaths stay off it.
 */
import { isIP } from "node:net";

/**
 * Only public http(s) URLs: no credentials, no local names (`localhost`,
 * `.localhost`, `.local`, `.internal`) and no private address literals
 * (`isPrivateAddress`). A host is an address only when it is an IP literal:
 * `10.example.com` is a name, and allowed.
 */
export function checkPublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http(s) URLs can be fetched.");
  }
  if (url.username || url.password) throw new Error("URLs with credentials are not allowed.");
  // The URL parser already turned every IPv4 spelling (`0x7f.1`, `2130706433`)
  // into dotted decimal and every IPv6 one into its compressed hex form.
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const privateHost = isIP(host) ? isPrivateAddress(host) : isLocalName(host);
  if (privateHost) throw new Error("Private and local addresses can't be fetched.");
  return url;
}

/** A name that only ever means this machine or its local network. */
function isLocalName(host: string): boolean {
  const name = host.replace(/\.+$/, ""); // `localhost.` is `localhost`
  return (
    name === "localhost" ||
    name.endsWith(".localhost") ||
    name.endsWith(".local") ||
    name.endsWith(".internal")
  );
}

/**
 * True for loopback, private, link-local, CGNAT (Tailscale), multicast and
 * unspecified addresses, and for an IPv4-mapped IPv6 address of any of them
 * (`::ffff:127.0.0.1`, or its hex form `::ffff:7f00:1`).
 */
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (isIP(ip) === 6) {
    const groups = ipv6Groups(ip);
    const mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
    if (mapped) {
      const [high, low] = [groups[6]!, groups[7]!];
      return isPrivateAddress(`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`);
    }
    const unspecifiedOrLoopback =
      groups.slice(0, 7).every((group) => group === 0) && groups[7]! <= 1;
    return (
      unspecifiedOrLoopback ||
      (groups[0]! & 0xfe00) === 0xfc00 || // unique local, fc00::/7
      (groups[0]! & 0xffc0) === 0xfe80 // link-local, fe80::/10
    );
  }
  return false;
}

/** The eight 16-bit groups of a valid IPv6 address (`isIP(ip) === 6`). */
function ipv6Groups(ip: string): number[] {
  let text = ip;
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = "", tail] = text.split("::");
  const before = head ? head.split(":") : [];
  const after = tail ? tail.split(":") : [];
  const zeros = tail === undefined ? 0 : 8 - before.length - after.length;
  return [...before, ...Array<string>(zeros).fill("0"), ...after].map((group) =>
    Number.parseInt(group, 16),
  );
}
