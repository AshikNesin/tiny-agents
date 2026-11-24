import type { CodePullRow } from "../../db";
import { sanitizePeerText } from "@tiny-agents/agent";
import { relayText } from "../bots/bots.delivery";
import type { CodePullKind } from "../notifications/notifications.events";
import { oweReport, projectHandoffOf } from "./code.store";

const NOTE_MAX = 300;

export type PullReportKind = CodePullKind | "opened";

function clip(text: string, max: number): string {
  const clean = sanitizePeerText(text).replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

const threadLink = (threadId: string) => `[Open in Code](/code/t/${encodeURIComponent(threadId)})`;

export async function reportToProject(
  threadId: string,
  report: { key: string; from: string; text: string },
): Promise<boolean> {
  const handoff = await projectHandoffOf(threadId);
  if (!handoff) return false;
  return oweReport(handoff, {
    requestId: `code-report-${handoff.id}-${report.key}`,
    harness: report.from,
    text: relayText(report.from, `${report.text} ${threadLink(threadId)}`),
  });
}

export function attentionNote(title: string, text: string): string {
  return `**${clip(title, 80)}** is waiting for the owner: ${clip(text, NOTE_MAX)}`;
}

function pullNote(
  pull: Pick<CodePullRow, "number" | "url" | "title">,
  kind: PullReportKind,
  detail?: string,
): string {
  const name = `[PR #${pull.number}](${pull.url})${pull.title ? ` ${clip(pull.title, 80)}` : ""}`;
  const why = detail ? `: ${clip(detail, NOTE_MAX)}` : ".";
  return {
    opened: `${name} opened.`,
    green: `${name} has green checks and is ready to merge.`,
    merged: `${name} merged.`,
    checks_failed: `Checks failed on ${name}${why}`,
    needs_input: `Auto-fix on ${name} needs the owner${why}`,
    off: `Auto-fix stopped on ${name}${why}`,
    stalled: `A check is stuck on ${name}${why}`,
  }[kind];
}

export function reportPull(
  pull: Pick<CodePullRow, "id" | "threadId" | "number" | "url" | "title" | "headSha">,
  kind: PullReportKind,
  detail?: string,
): Promise<boolean> {
  return reportToProject(pull.threadId, {
    key: `pr-${pull.id}-${kind}-${pull.headSha ?? ""}`,
    from: "GitHub",
    text: pullNote(pull, kind, detail),
  });
}
