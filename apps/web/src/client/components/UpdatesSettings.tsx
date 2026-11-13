/**
 * Settings → Updates (docs/guides/local-updates.md): for a server run by
 * `pnpm local`, the running commit, what the tracked ref has on top of it,
 * and "Update & restart". The build runs beside the running server; the page
 * reloads once the new one answers. Any other server says how to turn this on.
 */
import { Download, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@groot/ui/alert";
import { Button } from "@groot/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@groot/ui/card";
import { StatusBadge } from "@groot/ui/status-badge";
import type {
  UpdateCommit,
  UpdatePhase,
  UpdateRelease,
  UpdateStatus,
} from "../../shared/local-updates";
import { useUpdates } from "../store/use-updates";

const PHASE_BADGE: Record<UpdatePhase, { variant: string; label: string }> = {
  idle: { variant: "success", label: "Running" },
  checking: { variant: "pending", label: "Checking" },
  building: { variant: "active", label: "Building" },
  restarting: { variant: "active", label: "Restarting" },
  failed: { variant: "error", label: "Failed" },
};

/** The supervisor lists at most this many commits. */
const MAX_COMMITS = 50;

export function UpdatesSettings() {
  const { view, status, busy, updatingFrom, check, apply } = useUpdates();
  if (view === null) return <p className="text-muted-foreground text-sm">Loading…</p>;
  if (!view.supervised || !status) return <NotSupervisedCard />;

  const available = status.latest !== null && status.latest.sha !== status.current.sha;
  return (
    <div className="space-y-6">
      <StatusCard
        status={status}
        available={available}
        busy={busy}
        restarting={updatingFrom !== null}
        onApply={() => void apply()}
        onCheck={() => void check()}
      />
      {available && status.commits.length > 0 && <WhatsNewCard commits={status.commits} />}
      {(status.phase === "building" || status.phase === "failed") && status.log.length > 0 && (
        <BuildOutputCard log={status.log} />
      )}
    </div>
  );
}

function NotSupervisedCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Updates</CardTitle>
        <CardDescription>
          This server was not started with <code>pnpm local</code>, so it cannot update itself.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-muted-foreground space-y-2 text-sm">
        <p>
          On your own machine, stop the server and start it with <code>pnpm local</code> instead. It
          keeps a built copy of the latest commit, checks for new ones and lets you update and
          restart from here. Hosted deploys update by redeploying.
        </p>
      </CardContent>
    </Card>
  );
}

interface StatusCardProps {
  status: UpdateStatus;
  available: boolean;
  busy: boolean;
  /** "Update & restart" was pressed and the page waits for the new release. */
  restarting: boolean;
  onApply: () => void;
  onCheck: () => void;
}

function StatusCard({ status, available, busy, restarting, onApply, onCheck }: StatusCardProps) {
  const badge = PHASE_BADGE[status.phase];
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Updates</CardTitle>
          <StatusBadge status={badge.variant} label={badge.label} />
        </div>
        <CardDescription>
          Following <code>{status.track}</code>
          {status.auto ? ", updating automatically" : ""}. {checkedLabel(status.lastCheckedAt)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-1 text-sm sm:grid-cols-[8rem_1fr]">
          <ReleaseRow label="Running" release={status.current} />
          {available && status.latest && <ReleaseRow label="Available" release={status.latest} />}
        </dl>
        {status.error && (
          <Alert variant="destructive">
            <AlertTitle>Update failed</AlertTitle>
            <AlertDescription>{status.error}</AlertDescription>
          </Alert>
        )}
        {available && status.sandboxChanged && <SandboxChangedAlert />}
        <div className="flex flex-wrap gap-2">
          <Button onClick={onApply} disabled={!available || busy}>
            <Download className="size-4" />
            {applyLabel(status.phase, restarting)}
          </Button>
          <Button variant="outline" onClick={onCheck} disabled={busy}>
            <RefreshCw className="size-4" />
            {status.phase === "checking" ? "Checking…" : "Check now"}
          </Button>
        </div>
        {!available && status.latest && !busy && (
          <p className="text-muted-foreground text-sm">You are on the latest commit.</p>
        )}
        <p className="text-muted-foreground text-xs">
          The new version builds while this one keeps running; replies in progress pick up again
          after the restart. A version that fails to start is rolled back.
        </p>
      </CardContent>
    </Card>
  );
}

function ReleaseRow({ label, release }: { label: string; release: UpdateRelease }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>
        v{release.version} · {release.sha.slice(0, 7)}{" "}
        <span className="text-muted-foreground">{release.subject}</span>
      </dd>
    </>
  );
}

function SandboxChangedAlert() {
  return (
    <Alert>
      <AlertTitle>The sandbox image changed</AlertTitle>
      <AlertDescription>
        After updating, run <code>pnpm sandbox:up</code> to rebuild the local sandbox.
      </AlertDescription>
    </Alert>
  );
}

function WhatsNewCard({ commits }: { commits: UpdateCommit[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>What&apos;s new</CardTitle>
        <CardDescription>
          {commitCountLabel(commits.length)} since the running version.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1 text-sm">
          {commits.map((commit) => (
            <li key={commit.sha} className="flex gap-2">
              <code className="text-muted-foreground shrink-0">{commit.sha}</code>
              <span>{commit.subject}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function BuildOutputCard({ log }: { log: string[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Build output</CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="bg-muted max-h-72 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
          {log.join("\n")}
        </pre>
      </CardContent>
    </Card>
  );
}

function applyLabel(phase: UpdatePhase, restarting: boolean): string {
  if (phase === "building") return "Building…";
  if (phase === "restarting" || restarting) return "Restarting…";
  return "Update & restart";
}

function checkedLabel(lastCheckedAt: number | null): string {
  return lastCheckedAt
    ? `Checked ${new Date(lastCheckedAt).toLocaleString()}.`
    : "Not checked yet.";
}

function commitCountLabel(count: number): string {
  if (count >= MAX_COMMITS) return `The latest ${MAX_COMMITS} commits`;
  return count === 1 ? "1 commit" : `${count} commits`;
}
