import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { UpdatePhase, UpdateStatus } from "../../shared/local-updates";
import { useUpdateMutations, useUpdateView } from "../queries/updates";
import { errorMessage } from "../lib/errors";

const BUSY: UpdatePhase[] = ["checking", "building", "restarting"];

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
  const [updatingFrom, setUpdatingFrom] = useState<string | null>(null);
  const resource = useUpdateView((latest) => isBusy(latest?.status ?? null, updatingFrom));
  const { refresh } = resource;
  const view =
    resource.status === "ready"
      ? resource.data
      : resource.status === "failed"
        ? (resource.last ?? null)
        : null;
  const mutations = useUpdateMutations();
  const applying = mutations.apply.isPending;

  const status = view?.status ?? null;
  const busy = isBusy(status, updatingFrom);

  const outcome = applying ? "keep-polling" : pollOutcome(status, updatingFrom);
  useEffect(() => {
    if (outcome === "reload") window.location.reload();
    if (outcome === "update-failed") setUpdatingFrom(null);
  }, [outcome]);

  const check = useCallback(async () => {
    try {
      await mutations.check.mutateAsync();
      setTimeout(() => void refresh(), 500);
    } catch (error) {
      toast.error(errorMessage(error, "Could not check for updates"));
    }
  }, [mutations.check, refresh]);

  const apply = useCallback(async () => {
    if (!status) return;
    setUpdatingFrom(status.current.sha);
    try {
      await mutations.apply.mutateAsync();
    } catch (error) {
      setUpdatingFrom(null);
      toast.error(errorMessage(error, "Could not start the update"));
    }
  }, [status, mutations.apply]);

  return { view, status, busy, updatingFrom, check, apply };
}
