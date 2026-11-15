/**
 * The digest of what a vault item's value may be used for (issue #179, S11).
 * The local backend seals each value with it in the AAD and opens it only
 * under the digest of the row that links it, so a policy widened in the
 * database, rather than through the service (which re-seals), leaves the
 * value unreadable on every path.
 */
import { policyDigest } from "../../crypto/secret-box";
import type { VaultItem } from "../../db";

function list(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function json(raw: string | null | undefined): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** The policy columns the digest covers. */
export type PolicyColumns = Pick<
  VaultItem,
  "audience" | "originsJson" | "hostsJson" | "injectJson"
>;

/** Its audience, origins, hosts and injection, in a canonical form. */
export function vaultPolicyDigest(row: PolicyColumns): string {
  return policyDigest({
    audience: row.audience,
    origins: [...list(row.originsJson)].sort(),
    hosts: list(row.hostsJson)
      .map((h) => h.toLowerCase())
      .sort(),
    inject: json(row.injectJson) ?? null,
  });
}
