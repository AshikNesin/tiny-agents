import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@groot/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@groot/ui/dialog";
import { Text } from "@groot/ui/typography";
import { useStepUp } from "../../../components/vault/StepUp";
import { errorMessage } from "../../../lib/errors";
import type { Account, DiscoveredModel } from "../../../../shared/api/models";
import { useModelDiscovery, useModelMutations } from "../../../queries/models";
import { ModelChecklist } from "./AddModelsDialog";
import {
  cleanCustomProviders,
  CustomProvidersEditor,
  type CustomProvider,
} from "./CustomProvidersEditor";

function savedProviders(account: Account): CustomProvider[] {
  const list = account.settings.customProviders;
  const saved = Array.isArray(list) ? (list as CustomProvider[]) : [];
  const known = new Set(saved.map((p) => p.slug));
  const unsaved = new Set<string>();
  for (const model of account.models) {
    const slug = model.upstreamId.split("/")[0];
    if (slug?.startsWith("custom-") && model.upstreamId.includes("/") && !known.has(slug)) {
      unsaved.add(slug);
    }
  }
  return [...saved, ...[...unsaved].map((slug) => ({ slug, basePath: "" }))];
}

export function GatewayCustomProvidersDialog({
  account,
  onClose,
  onChanged,
}: {
  account: Account;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { run } = useStepUp();
  const { updateConnection, addModel } = useModelMutations();
  const { refresh } = useModelDiscovery();
  const [rows, setRows] = useState<CustomProvider[]>(() => savedProviders(account));
  const [found, setFound] = useState<DiscoveredModel[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const customProviders = cleanCustomProviders(rows);
      const saved = await run(() =>
        updateConnection.mutateAsync({
          id: account.id,
          input: {
            settings: {
              accountId: String(account.settings.accountId ?? ""),
              gatewayId: String(account.settings.gatewayId ?? ""),
              customProviders,
            },
          },
        }),
      );
      if (!saved) return;
      onChanged();
      const { available } = await refresh.mutateAsync(account.id);
      const slugs = customProviders.map((p) => `${p.slug}/`);
      const custom = available.filter((m) => slugs.some((slug) => m.upstreamId.startsWith(slug)));
      if (custom.length === 0) {
        toast.success(
          customProviders.length > 0
            ? "Saved. The custom providers list no new models: add them by id on the card."
            : "Saved",
        );
        onClose();
        return;
      }
      setFound(custom);
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't save the custom providers"));
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    setBusy(true);
    try {
      await Promise.all(
        [...chosen].map((upstreamId) =>
          addModel.mutateAsync({ accountId: account.id, input: { upstreamId } }),
        ),
      );
      toast.success(`Added ${chosen.size} model${chosen.size === 1 ? "" : "s"}`);
      onChanged();
      onClose();
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't add the models"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Custom providers on {account.name}</DialogTitle>
          <DialogDescription>
            Their models run through this gateway on its token, beside its own.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {found === null ? (
            <CustomProvidersEditor value={rows} onChange={setRows} />
          ) : (
            <>
              <Text variant="meta" className="block">
                Pick the models to add.
              </Text>
              <ModelChecklist models={found} chosen={chosen} setChosen={setChosen} />
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {found === null ? "Cancel" : "Done"}
          </Button>
          {found === null ? (
            <Button onClick={save} disabled={busy}>
              Save
            </Button>
          ) : (
            <Button onClick={add} disabled={busy || chosen.size === 0}>
              Add models
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
