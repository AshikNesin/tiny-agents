import { checkPublicUrl } from "./public-url";

export function assertRefShape(ref: string): void {
  if (!/^(?:f\d+)?e\d+$/.test(ref)) {
    throw new Error(`Invalid ref "${ref}". Use a ref from the last snapshot.`);
  }
}

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

export function isBlockedPrivateUrl(raw: string, exempt?: string | ReadonlySet<string>): boolean {
  try {
    const url = new URL(raw);
    if (exemptSet(exempt).has(url.hostname.toLowerCase())) return false;
    checkPublicUrl(raw);
    return false;
  } catch {
    return true;
  }
}

export function checkNavigableUrl(raw: string, exempt: ReadonlySet<string>): URL {
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
  return checkPublicUrl(raw);
}
