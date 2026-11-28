import { parseJson } from "@tiny-agents/std";
import { z } from "zod";
import { policyDigest } from "../../crypto/secret-box";
import type { VaultItem } from "../../db";

function list(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    return parseJson("A vault item's list", raw, z.array(z.unknown())).filter(
      (v): v is string => typeof v === "string",
    );
  } catch {
    return [];
  }
}

function json(raw: string | null | undefined): unknown {
  if (!raw) return undefined;
  try {
    return parseJson("A vault item's header rule", raw, z.unknown());
  } catch {
    return undefined;
  }
}

export type PolicyColumns = Pick<
  VaultItem,
  "audience" | "originsJson" | "hostsJson" | "injectJson"
>;

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
