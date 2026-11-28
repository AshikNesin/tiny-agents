import { preferredMergeMethod, type WorkflowName } from "../../../shared/code-status";
import { Kbd } from "../../components/keys";
import { GitMerge, MessageSquare, Wrench, Zap } from "lucide-react";
import { Button, metaLabelClass } from "@groot/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@groot/ui/dropdown-menu";
import { Spinner } from "../../components/ui/spinner";
import { Switch } from "@groot/ui/switch";
import type { MergeMethod, PullView } from "../../../shared/api/code";
import { PullChecks } from "./PullChecks";
import { PullComments } from "./PullComments";
import { autofixLabels } from "../../../shared/machines/autofix";
import { MachineStatusBadge } from "../../components/MachineStatusBadge";

const OUTCOME_LABEL: Record<string, string> = {
  pushed: "Pushed",
  clean: "Nothing to change",
  no_progress: "No commit",
  rejected: "Push rejected",
  protected_path: "Not pushed: protected path",
  timed_out: "Timed out",
  diverged: "Branch diverged",
  send_failed: "Could not start",
};

export function ActivePull({
  threadId,
  pr,
  busy,
  onAutofix,
  onFix,
  onMerge,
  onYolo,
  onDraft,
  onAttachAll,
  onAttach,
}: {
  threadId: string;
  pr: PullView;
  busy: string | null;
  onAutofix(enabled: boolean): void;
  onFix(workflow: WorkflowName): void;
  onMerge(method: MergeMethod): void;
  onYolo(method: MergeMethod | null): void;
  onDraft(draft: boolean): void;
  onAttachAll(): void;
  onAttach(text: string): void;
}) {
  const snap = pr.snapshot;
  const failing = (snap?.checks ?? []).some((c) => c.state === "failure");
  const open = (snap?.threads ?? []).filter((t) => !t.resolved);
  const methods = snap?.mergeMethods ?? [];
  const conflicting = snap?.mergeable === "conflicting";
  const mergeBlocked =
    failing && conflicting
      ? "Merge opens once checks pass and the conflict is resolved."
      : failing
        ? "Merge opens once checks pass."
        : conflicting
          ? "Merge opens once the conflict is resolved."
          : null;

  const yoloMethod = preferredMergeMethod(methods);

  return (
    <>
      <PullChecks threadId={threadId} pr={pr} busy={busy} onFix={() => onFix("fix_ci")} />

      {pr.yolo && pr.state === "open" && (
        <div
          role="status"
          aria-label="YOLO Merge"
          className="border-warning/40 bg-warning/10 flex items-center gap-3 rounded-xl border px-3 py-2.5"
        >
          <Zap className="text-warning size-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-medium">YOLO Merge is on.</span> Merges #{pr.number} by itself
            once it can.{pr.yolo.waiting ? ` ${pr.yolo.waiting}` : ""}
          </p>
          <Button size="sm" variant="outline" onClick={() => onYolo(null)} disabled={busy !== null}>
            Call off
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {pr.state === "open" && methods.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button size="sm" disabled={busy !== null || pr.draft || mergeBlocked !== null} />
              }
            >
              {busy === "merge" ? <Spinner /> : <GitMerge />}
              Merge
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {methods.map((m) => (
                <DropdownMenuItem key={m} onSelect={() => onMerge(m)}>
                  {m === "squash"
                    ? "Squash and merge"
                    : m === "rebase"
                      ? "Rebase and merge"
                      : "Create a merge commit"}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {pr.state === "open" && !pr.yolo && yoloMethod && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onYolo(yoloMethod)}
            disabled={busy !== null}
            title="Resolves every open comment, waits for the checks, then merges by itself"
            data-testid="code-yolo-merge"
          >
            {busy === "arm YOLO Merge" ? <Spinner /> : <Zap />}
            YOLO Merge
          </Button>
        )}
        {pr.state === "open" && (pr.draft || mergeBlocked) && (
          <span className="text-muted-foreground self-center text-xs">
            {pr.draft ? "Turn Draft off to merge" : mergeBlocked}
          </span>
        )}
        {open.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onFix("address_comments")}
            disabled={busy !== null || pr.state !== "open"}
            title="The agent answers the open review comments in this thread"
            data-testid="code-address-comments"
          >
            {busy === "start a pass" ? <Spinner /> : <Wrench />}
            Address comments
            <Kbd keys="a" />
          </Button>
        )}
        {snap?.mergeable === "conflicting" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onFix("resolve_conflicts")}
            disabled={busy !== null || pr.state !== "open"}
          >
            <Wrench />
            Resolve conflicts
          </Button>
        )}
        {open.length > 0 && (
          <Button size="sm" variant="outline" onClick={onAttachAll}>
            <MessageSquare />
            Attach all comments
          </Button>
        )}
      </div>

      <section
        className="border-border divide-border divide-y rounded-xl border"
        aria-label="Auto-fix"
      >
        <div className="space-y-1 px-3 py-2.5">
          <label
            className="flex items-center gap-3"
            title="Fixes failing checks, trusted review comments and conflicts while you are away, in this thread's permission mode."
          >
            <span className="min-w-0 flex-1 font-medium">Auto-fix</span>
            {pr.autofix && (
              <MachineStatusBadge
                plain
                status={pr.loop.status}
                labels={autofixLabels}
                className="text-xs"
              />
            )}
            <Switch
              checked={pr.autofix}
              onCheckedChange={onAutofix}
              disabled={busy !== null || pr.state !== "open"}
              aria-label="Auto-fix"
              data-testid="code-autofix"
            />
          </label>
          {pr.loop.reason && pr.loop.status !== "watching" && (
            <p className="text-muted-foreground text-xs">{pr.loop.reason}</p>
          )}
        </div>
        {pr.state === "open" && (
          <label
            className="flex items-center gap-3 px-3 py-2.5"
            title="A draft is not ready for review, and cannot be merged"
          >
            <span className="min-w-0 flex-1">Draft</span>
            {(busy === "mark it ready" || busy === "convert it to a draft") && <Spinner />}
            <Switch
              checked={pr.draft}
              onCheckedChange={onDraft}
              disabled={busy !== null}
              aria-label="Draft"
              data-testid="code-draft"
            />
          </label>
        )}
      </section>

      {pr.passes.length > 0 && (
        <section className="space-y-1" aria-label="Auto-fix passes">
          <h3 className={metaLabelClass}>Passes</h3>
          <ul className="space-y-1">
            {pr.passes.map((p) => (
              <li key={p.id} className="flex items-baseline gap-2">
                <span className="text-muted-foreground w-16 shrink-0 text-xs">{p.trigger}</span>
                <span
                  className="min-w-0 flex-1 truncate"
                  title={p.items.map((i) => i.title).join(", ")}
                >
                  {p.items.map((i) => i.title).join(", ") || "Manual pass"}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {p.status === "finished"
                    ? (OUTCOME_LABEL[p.outcome ?? ""] ?? p.outcome)
                    : "Running"}
                  {p.pushedSha ? ` ${p.pushedSha.slice(0, 7)}` : ""}
                  {p.costUsd !== null ? ` · $${p.costUsd.toFixed(2)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <PullComments pr={pr} onAttach={onAttach} />
    </>
  );
}
