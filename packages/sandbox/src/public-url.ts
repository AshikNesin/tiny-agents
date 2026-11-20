import { isIP } from "node:net";

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
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const privateHost = isIP(host) ? isPrivateAddress(host) : isLocalName(host);
  if (privateHost) throw new Error("Private and local addresses can't be fetched.");
  return url;
}

function isLocalName(host: string): boolean {
  const name = host.replace(/\.+$/, "");
  return (
    name === "localhost" ||
    name.endsWith(".localhost") ||
    name.endsWith(".local") ||
    name.endsWith(".internal")
  );
}

export function isPrivateAddress(address: string): boolean {
  const ip = address
    .replace(/^\[|\]$/g, "")
    .replace(/%.*$/, "")
    .toLowerCase();
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split(".").map(Number) as [number, number, number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (isIP(ip) === 6) {
    const g = ipv6Groups(ip);
    const zero = (from: number, to: number) => g.slice(from, to).every((group) => group === 0);
    const v4 = (high: number, low: number) =>
      `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
    const embedsLastV4 =
      (zero(0, 5) && g[5] === 0xffff) ||
      (zero(0, 4) && g[4] === 0xffff && g[5] === 0) ||
      zero(0, 6) ||
      (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6));
    if (embedsLastV4) return isPrivateAddress(v4(g[6]!, g[7]!));
    if (g[0] === 0x2002) return isPrivateAddress(v4(g[1]!, g[2]!));
    const first = g[0]!;
    return (
      (first === 0x64 && g[1] === 0xff9b && g[2] === 1) ||
      (first & 0xfe00) === 0xfc00 ||
      (first & 0xffc0) === 0xfe80 ||
      (first & 0xffc0) === 0xfec0 ||
      (first & 0xff00) === 0xff00
    );
  }
  return false;
}

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
