import { parseJson, record } from "@tiny-agents/std";
import { z } from "zod";
import type { CodePullRow } from "../../db";
import type { PullView } from "../../../shared/api/code";
import { ignoredItems, stalledChecks, type AutofixSettings } from "./code.autofix";
import { appCommentIds, cachedSnapshot, passesOf } from "./code.pulls.store";

export async function pullView(
  row: CodePullRow,
  owner: { login: string | null } | undefined,
  settings: AutofixSettings,
): Promise<PullView> {
  const snapshot = cachedSnapshot(row);
  const passes = await passesOf(row.id);
  const ignored =
    snapshot && owner
      ? ignoredItems({
          snapshot,
          appCommentIds: await appCommentIds(row.id),
          ownerLogin: owner.login,
          settings,
        })
      : [];
  return {
    id: row.id,
    number: row.number,
    url: row.url,
    title: row.title,
    state: row.state,
    draft: row.draft,
    headRef: row.headRef,
    baseRef: row.baseRef,
    syncedAt: row.syncedAt?.toISOString() ?? null,
    autofix: row.autofix,
    loop: { status: row.loopStatus, reason: row.loopReason },
    yolo: row.yoloMethod ? { method: row.yoloMethod, waiting: row.yoloWaiting } : null,
    snapshot,
    stalled: snapshot
      ? stalledChecks(snapshot, Date.now(), settings.stallHours).map((c) => c.name)
      : [],
    ignored,
    passes: passes.map((p) => ({
      id: p.id,
      trigger: p.trigger,
      status: p.status,
      outcome: p.outcome,
      detail: p.detail,
      items: passItems(p.items),
      pushedSha: p.pushedSha,
      costUsd: p.costUsd,
      createdAt: p.createdAt.toISOString(),
      finishedAt: p.finishedAt?.toISOString() ?? null,
    })),
  };
}

function passItems(raw: string): Array<{ id: string; title: string }> {
  try {
    return parseJson("An Auto-fix pass's items", raw, z.array(z.unknown())).flatMap((i) => {
      const item = record(i);
      return typeof item?.id === "string"
        ? [{ id: item.id, title: typeof item.title === "string" ? item.title : item.id }]
        : [];
    });
  } catch {
    return [];
  }
}
