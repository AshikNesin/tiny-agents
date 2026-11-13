/**
 * Settings → Updates (docs/guides/local-updates.md): for a server run by
 * `pnpm local`, the running commit, what the tracked ref has on top of it,
 * and "Update & restart". The build runs beside the running server; the page
 * reloads once the new one answers. Any other server says how to turn this on.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@groot/ui/alert";
import { Button } from "@groot/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@groot/ui/card";
import { StatusBadge } from "@groot/ui/status-badge";
import type { UpdatePhase, UpdateRelease, UpdateView } from "../../shared/local-updates";
import { updatesApi } from "../lib/updates-api";
import { errorMessage } from "../lib/errors";

const BUSY: UpdatePhase[] = ["checking", "building", "restarting"];
const POLL_MS = 2000;

const PHASE_BADGE: Record<UpdatePhase, { variant: string; label: string }> = {
  idle: { variant: "success", label: "Running" },
  checking: { variant: "pending", label: "Checking" },
  building: { variant: "active", label: "Building" },
  restarting: { variant: "active", label: "Restarting" },
  failed: { variant: "error", label: "Failed" },
};

function short(release: UpdateRelease): string {
  return `v${release.version} · ${release.sha.slice(0, 7)}`;
}

export function UpdatesSettings() {
  const [view, setView] = useState<UpdateView | null>(null);
  /** The commit running when "Update & restart" was pressed; the page reloads once it changes. */
  const [updatingFrom, setUpdatingFrom] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const next = await updatesApi.get();
      setView(next);
      return next;
    } catch {
      // The server is restarting: keep the last view and try again.
      return null;
    }
  }, []);

  const status = view?.status ?? null;
  const busy = updatingFrom !== null || (status !== null && BUSY.includes(status.phase));

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!busy) return;
    const tick = async () => {
      const next = await load();
      const now = next?.status;
      if (updatingFrom && now && now.current.sha !== updatingFrom && now.phase === "idle") {
        window.location.reload();
        return;
      }
      if (updatingFrom && now?.phase === "failed") setUpdatingFrom(null);
      timer.current = setTimeout(() => void tick(), POLL_MS);
    };
    timer.current = setTimeout(() => void tick(), POLL_MS);
    return () => clearTimeout(timer.current);
  }, [busy, load, updatingFrom]);

  const check = async () => {
    try {
      setView(await updatesApi.check());
      // The answer comes from the supervisor a moment later.
      setTimeout(() => void load(), 500);
    } catch (error) {
      toast.error(errorMessage(error, "Could not check for updates"));
    }
  };

  const apply = async () => {
    if (!status) return;
    try {
      setUpdatingFrom(status.current.sha);
      setView(await updatesApi.apply());
    } catch (error) {
      setUpdatingFrom(null);
      toast.error(errorMessage(error, "Could not start the update"));
    }
  };

  if (view === null) return <p className="text-muted-foreground text-sm">Loading…</p>;

  if (!view.supervised || !status) {
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
            On your own machine, stop the server and start it with <code>pnpm local</code> instead.
            It keeps a built copy of the latest commit, checks for new ones and lets you update and
            restart from here. Hosted deploys update by redeploying.
          </p>
        </CardContent>
      </Card>
    );
  }

  const available = status.latest !== null && status.latest.sha !== status.current.sha;
  const badge = PHASE_BADGE[status.phase];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Updates</CardTitle>
            <StatusBadge status={badge.variant} label={badge.label} />
          </div>
          <CardDescription>
            Following <code>{status.track}</code>
            {status.auto ? ", updating automatically" : ""}.{" "}
            {status.lastCheckedAt
              ? `Checked ${new Date(status.lastCheckedAt).toLocaleString()}.`
              : "Not checked yet."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-1 text-sm sm:grid-cols-[8rem_1fr]">
            <dt className="text-muted-foreground">Running</dt>
            <dd>
              {short(status.current)}{" "}
              <span className="text-muted-foreground">{status.current.subject}</span>
            </dd>
            {available && status.latest && (
              <>
                <dt className="text-muted-foreground">Available</dt>
                <dd>
                  {short(status.latest)}{" "}
                  <span className="text-muted-foreground">{status.latest.subject}</span>
                </dd>
              </>
            )}
          </dl>

          {status.error && (
            <Alert variant="destructive">
              <AlertTitle>Update failed</AlertTitle>
              <AlertDescription>{status.error}</AlertDescription>
            </Alert>
          )}

          {available && status.sandboxChanged && (
            <Alert>
              <AlertTitle>The sandbox image changed</AlertTitle>
              <AlertDescription>
                After updating, run <code>pnpm sandbox:up</code> to rebuild the local sandbox.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void apply()} disabled={!available || busy}>
              <Download className="size-4" />
              {status.phase === "building"
                ? "Building…"
                : status.phase === "restarting" || updatingFrom
                  ? "Restarting…"
                  : "Update & restart"}
            </Button>
            <Button variant="outline" onClick={() => void check()} disabled={busy}>
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

      {available && status.commits.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>What&apos;s new</CardTitle>
            <CardDescription>
              {status.commits.length === 50
                ? "The latest 50 commits"
                : `${status.commits.length} commits`}{" "}
              since the running version.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {status.commits.map((commit) => (
                <li key={commit.sha} className="flex gap-2">
                  <code className="text-muted-foreground shrink-0">{commit.sha}</code>
                  <span>{commit.subject}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {status.log.length > 0 && (status.phase === "building" || status.phase === "failed") && (
        <Card>
          <CardHeader>
            <CardTitle>Build output</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted max-h-72 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
              {status.log.join("\n")}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
