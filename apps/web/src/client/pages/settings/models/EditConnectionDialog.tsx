import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@groot/ui/button";
import { Checkbox } from "@groot/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@groot/ui/dialog";
import { Field } from "@groot/ui/form";
import { Input } from "@groot/ui/input";
import { Label } from "@groot/ui/label";
import { useStepUp } from "../../../components/vault/StepUp";
import { errorMessage } from "../../../lib/errors";
import type { Account } from "../../../../shared/api/models";
import { useModelMutations } from "../../../queries/models";

export function EditConnectionDialog({
  account,
  onClose,
  onSaved,
}: {
  account: Account;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { run } = useStepUp();
  const { updateConnection } = useModelMutations();
  const [baseUrl, setBaseUrl] = useState(account.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [allowPrivate, setAllowPrivate] = useState(account.allowPrivateNetwork);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const saved = await run(() =>
        updateConnection.mutateAsync({
          id: account.id,
          input: {
            ...(account.kind !== "cloudflare-ai-gateway" &&
            baseUrl.trim() !== (account.baseUrl ?? "")
              ? { baseUrl: baseUrl.trim() }
              : {}),
            ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
            allowPrivateNetwork: allowPrivate,
          },
        }),
      );
      if (!saved) return;
      toast.success(`Saved ${saved.name}`);
      onSaved();
      onClose();
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't save the connection"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {account.name}</DialogTitle>
          <DialogDescription>
            A new host needs its key again: keys only go to the host they were saved for.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {account.kind !== "cloudflare-ai-gateway" && !account.viaProviderId && (
            <Field label="Endpoint" htmlFor="edit-endpoint">
              <Input
                id="edit-endpoint"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </Field>
          )}
          {!account.viaProviderId && (
            <Field label="API key" htmlFor="edit-key" hint="Leave blank to keep the saved key.">
              <Input
                id="edit-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </Field>
          )}
          {account.kind !== "cloudflare-ai-gateway" && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="edit-private"
                checked={allowPrivate}
                onCheckedChange={(checked) => setAllowPrivate(checked === true)}
              />
              <Label htmlFor="edit-private" className="font-normal">
                Private or local endpoint
              </Label>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
