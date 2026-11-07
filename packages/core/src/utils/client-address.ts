const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** Trusted when `TRUSTED_PROXIES` is unset: loopback and the private IPv4 ranges. */
export const PRIVATE_NETWORKS = [
  "127.0.0.0/8",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "::1",
] as const;

/** A trusted proxy entry: an IPv4 address or range (`10.0.0.0/8`), or an IPv6 address. */
export function isProxyEntry(entry: string): boolean {
  const [address = "", prefix, extra] = entry.split("/");
  if (extra !== undefined) return false;
  if (IPV4.test(address)) return prefix === undefined || /^(3[0-2]|[12]?\d)$/.test(prefix);
  return prefix === undefined && canonicalIpv6(address) !== undefined;
}

export function clientAddress(
  peer: string | undefined,
  forwardedFor: string | undefined,
  trustedProxies: readonly string[],
): string | undefined {
  if (peer === undefined) return undefined;
  const address = unmapIpv4(peer);
  if (!forwardedFor || !isTrusted(address, trustedProxies)) return address;
  const hops = forwardedFor
    .split(",")
    .map((hop) => unmapIpv4(hop.trim()))
    .filter(Boolean);
  return rightmostUntrustedHop(hops, trustedProxies) ?? address;
}

/**
 * Each proxy appends the address it saw, so only hops right of the first
 * untrusted one were written by trusted proxies; everything left of it is the
 * client's own text. With every hop trusted, the leftmost is the client.
 */
function rightmostUntrustedHop(
  hops: readonly string[],
  trustedProxies: readonly string[],
): string | undefined {
  return hops.findLast((hop) => !isTrusted(hop, trustedProxies)) ?? hops[0];
}

function isTrusted(address: string, trustedProxies: readonly string[]): boolean {
  return trustedProxies.some((entry) => matches(address, entry));
}

function matches(address: string, entry: string): boolean {
  const [base = "", prefix] = entry.split("/");
  if (IPV4.test(base)) {
    if (!IPV4.test(address)) return false;
    const bits = prefix === undefined ? 32 : Number(prefix);
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipv4ToNumber(address) & mask) >>> 0 === (ipv4ToNumber(base) & mask) >>> 0;
  }
  const canonical = canonicalIpv6(address);
  return canonical !== undefined && canonical === canonicalIpv6(base);
}

function ipv4ToNumber(address: string): number {
  return address.split(".").reduce((n, octet) => n * 256 + Number(octet), 0);
}

/** Node reports an IPv4 peer on a dual-stack socket as `::ffff:a.b.c.d`. */
function unmapIpv4(address: string): string {
  const unmapped = address.replace(/^::ffff:/i, "");
  return IPV4.test(unmapped) ? unmapped : address;
}

function canonicalIpv6(address: string): string | undefined {
  if (!address.includes(":")) return undefined;
  try {
    return new URL(`http://[${address}]`).hostname;
  } catch {
    return undefined;
  }
}
