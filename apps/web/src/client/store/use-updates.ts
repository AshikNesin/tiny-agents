/**
 * Settings → Updates state (docs/guides/local-updates.md): the supervisor's
 * status, polled while something is happening, and the check and apply
 * actions. After "Update & restart" it polls through the restart and reloads
 * the page once the new release answers.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { UpdatePhase, UpdateStatus, UpdateView } from "../../shared/local-updates";
import { updatesApi } from "../lib/updates-api";
import { errorMessage } from "../lib/errors";

const BUSY: UpdatePhase[] = ["checking", "building", "restarting"];
const POLL_MS = 2000;

/** What a poll means, given the status it read and the commit an update started from. */
export function pollOutcome(
  status: UpdateStatus | null | undefined,
  updatingFrom: string | null,
): "reload" | "update-failed" | "keep-polling" {
  if (!updatingFrom || !status) return "keep-polling";
  if (status.phase === "failed") return "update-failed";
  if (status.phase === "idle" && status.current.sha !== updatingFrom) return "reload";
  return "keep-polling";
}

export function isBusy(status: UpdateStatus | null, updatingFrom: string | null): boolean {
  return updatingFrom !== null || (status !== null && BUSY.includes(status.phase));
}

export function useUpdates() {
  const [view, setView] = useState<UpdateView | null>(null);
  /** The commit running when "Update & restart" was pressed; the page reloads once it changes. */
  const [updatingFrom, setUpdatingFrom] = useState<string | null>(null);

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
  const busy = isBusy(status, updatingFrom);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!busy) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const next = await load();
      const outcome = pollOutcome(next?.status, updatingFrom);
      if (outcome === "reload") return window.location.reload();
      if (outcome === "update-failed") setUpdatingFrom(null);
      timer = setTimeout(() => void tick(), POLL_MS);
    };
    timer = setTimeout(() => void tick(), POLL_MS);
    return () => clearTimeout(timer);
  }, [busy, load, updatingFrom]);

  const check = useCallback(async () => {
    try {
      setView(await updatesApi.check());
      // The answer comes from the supervisor a moment later.
      setTimeout(() => void load(), 500);
    } catch (error) {
      toast.error(errorMessage(error, "Could not check for updates"));
    }
  }, [load]);

  const apply = useCallback(async () => {
    if (!status) return;
    setUpdatingFrom(status.current.sha);
    try {
      setView(await updatesApi.apply());
    } catch (error) {
      setUpdatingFrom(null);
      toast.error(errorMessage(error, "Could not start the update"));
    }
  }, [status]);

  return { view, status, busy, updatingFrom, check, apply };
}
