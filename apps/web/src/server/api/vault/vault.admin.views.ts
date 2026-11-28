import { parseEach, parseJson } from "@tiny-agents/std";
import { z } from "zod";
import { logger } from "@groot/core/logger";
import type { VaultApproval, VaultKind } from "@tiny-agents/agent";
import { app } from "../../app-root";
import { readBackends, writeBackends } from "./backends";
import type { BackendItemSummary, BackendName, ValueField } from "./backends/types";
import type { VaultBackendView, VaultItemData } from "../../../shared/api/vault";
import {
  backendStatus,
  effectiveApproval,
  effectiveTools,
  toMeta,
  type VaultItemRow,
} from "./vault.service";

const CANDIDATES_TTL_MS = 5 * 60_000;
const UNREADABLE_TITLE = "Unreadable item";

export async function candidates(force = false) {
  const cached = app().vault.candidates;
  if (!force && cached && Date.now() - cached.at < CANDIDATES_TTL_MS) {
    return cached.items;
  }
  const items: (BackendItemSummary & { backend: BackendName })[] = [];
  for (const [name, backend] of readBackends()) {
    const listed = await backend.listCandidates().catch((error: unknown) => {
      logger.warn({ backend: name, error: (error as Error).message }, "Vault listing failed");
      return { items: [], unreadable: [] };
    });
    items.push(...listed.items.map((item) => ({ ...item, backend: name })));
    if (listed.unreadable.length > 0) {
      logger.warn(
        { backend: name, unreadable: listed.unreadable },
        "Vault items can't be read; listed as unreadable",
      );
    }
    items.push(
      ...listed.unreadable.map(({ externalId }) => ({
        externalId,
        title: UNREADABLE_TITLE,
        kind: "other" as const,
        urls: [],
        hasTotp: false,
        fields: [],
        backend: name,
      })),
    );
  }
  app().vault.candidates = { at: Date.now(), items };
  return items;
}

function parseList(raw: string | null): string[] {
  try {
    return parseEach(
      parseJson("A vault item's list", raw ?? "[]", z.array(z.unknown())),
      z.string(),
      (_value, problem) =>
        logger.warn({ problem }, "Skipped a vault list entry that does not fit its shape"),
    );
  } catch {
    return [];
  }
}

export function itemView(row: VaultItemRow): VaultItemData {
  const meta = toMeta(row);
  return {
    id: row.id,
    handle: row.handle,
    kind: row.kind as VaultKind,
    backend: row.backend as BackendName,
    audience: row.audience as VaultItemData["audience"],
    label: row.label,
    username: row.username,
    origins: meta.origins,
    hosts: meta.allowedHosts,
    inject: meta.inject ?? null,
    tools: parseList(row.toolsJson),
    effectiveTools: effectiveTools(row),
    bots: row.botsJson === null ? null : parseList(row.botsJson),
    approval: row.approval as VaultApproval,
    effectiveApproval: effectiveApproval(row),
    allowUnattended: row.allowUnattended,
    whenToUse: row.whenToUse,
    card: meta.card ?? null,
    hasTotp: row.hasTotp,
    disabled: row.disabled,
    field: row.field as ValueField | null,
    lastUsedAt: row.lastUsedAt,
    lastUsedBy: row.lastUsedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function backendsView(): Promise<VaultBackendView[]> {
  const views: VaultBackendView[] = [];
  for (const name of ["onepassword", "local"] as BackendName[]) {
    const read = readBackends().get(name);
    if (!read) continue;
    const write = writeBackends().get(name);
    const readStatus = await backendStatus(name);
    const writeStatus = name === "local" || !write ? readStatus : await write.status();
    views.push({
      name,
      configured: true,
      read: readStatus,
      write: writeStatus,
      capabilities: write?.capabilities ?? read.capabilities,
    });
  }
  return views;
}

export function metadataOf(summary: BackendItemSummary) {
  return {
    username: summary.username ?? null,
    cardMetaJson: summary.card ? JSON.stringify(summary.card) : null,
    hasTotp: summary.hasTotp,
  };
}
