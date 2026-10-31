/**
 * Shared guards for the browser toolkit and its transports: the ref shape a
 * snapshot hands out, and the URL rules (public hosts only, with the owner's
 * private exemptions). Kept apart from the toolkit so a transport can check
 * a redirect hop without importing the toolkit that imports it.
 */
import { checkPublicUrl } from "./web";

/** Ref from the last snapshot: `e12`, or `f1e12` for an element inside a frame. */
export function assertRefShape(ref: string): void {
  if (!/^(?:f\d+)?e\d+$/.test(ref)) {
    throw new Error(`Invalid ref "${ref}". Use a ref from the last snapshot.`);
  }
}

/** The comma-separated exemption list as a set of lowercase hostnames. */
export function parseExemptHosts(allowedPrivateHosts: string | undefined): Set<string> {
  return new Set(
    (allowedPrivateHosts ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

const exemptSet = (exempt: string | ReadonlySet<string> | undefined): ReadonlySet<string> =>
  typeof exempt === "string" || exempt === undefined ? parseExemptHosts(exempt) : exempt;

/**
 * True when a URL is private/loopback and not exempt. The toolkit validates
 * the submitted URL; the transport re-checks every redirect hop, so an open
 * redirect on a public site cannot reach the private network.
 */
export function isBlockedPrivateUrl(raw: string, exempt?: string | ReadonlySet<string>): boolean {
  try {
    const url = new URL(raw);
    if (exemptSet(exempt).has(url.hostname.toLowerCase())) return false;
    checkPublicUrl(raw);
    return false;
  } catch {
    return true; // invalid or private
  }
}

/** The URL a navigate may open: http(s), no credentials, public or exempt. */
export function checkNavigableUrl(raw: string, exempt: ReadonlySet<string>): URL {
  // Validate shape first (protocol, credentials), then decide on the host.
  let candidate: URL;
  try {
    candidate = new URL(raw);
  } catch {
    throw new Error(`Not a valid URL: ${raw}`);
  }
  if (candidate.protocol !== "http:" && candidate.protocol !== "https:") {
    throw new Error("Only http(s) URLs can be opened.");
  }
  if (candidate.username || candidate.password) {
    throw new Error("URLs with credentials are not allowed.");
  }
  if (exempt.has(candidate.hostname.toLowerCase())) return candidate;
  return checkPublicUrl(raw); // throws for every other private host
}
