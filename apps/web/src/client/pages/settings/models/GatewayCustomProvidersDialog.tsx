/**
 * Edit a gateway account's custom providers (issue #216), then pick which of
 * their models to add. Saving changes the account's connection, so it asks
 * for step-up; the models each provider lists come back to choose from.
 */
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
import { modelsApi } from "../../../lib/models-api";
import { ModelChecklist } from "./AddModelsDialog";
import {
  cleanCustomProviders,
  CustomProvidersEditor,
  type CustomProvider,
} from "./CustomProvidersEditor";

/**
 * What is saved, plus a row for each `custom-…` slug the account's models
 * name that isn't saved yet (a model added by id): only its base path to fill.
 */
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

/** Mounted per open, so it starts from what is saved. */
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
  const [rows, setRows] = useState<CustomProvider[]>(() => savedProviders(account));
  const [found, setFound] = useState<DiscoveredModel[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const customProviders = cleanCustomProviders(rows);
      const saved = await run(() =>
        modelsApi.updateConnection(account.id, {
          settings: {
            accountId: String(account.settings.accountId ?? ""),
            gatewayId: String(account.settings.gatewayId ?? ""),
            customProviders,
          },
        }),
      );
      if (!saved) return;
      onChanged();
      // What the custom providers list that the account doesn't have yet.
      const { available } = await modelsApi.refresh(account.id);
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
        [...chosen].map((upstreamId) => modelsApi.addModel(account.id, { upstreamId })),
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
