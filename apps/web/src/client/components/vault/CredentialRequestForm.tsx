import { useState } from "react";
import { toast } from "sonner";
import { ShieldAlert } from "lucide-react";
import { Button } from "@groot/ui/button";
import { Field } from "@groot/ui/form";
import { Input } from "@groot/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@groot/ui/select";
import { monoClass } from "@groot/ui/typography";
import type { CredentialRequestView } from "../../../shared/api/vault";
import { apiError } from "../../lib/vault-api";
import { useVaultMutations } from "../../queries/vault";
import { Switch } from "@groot/ui/switch";
import { SecretInput } from "./SecretInput";

const MASKED = new Set(["password", "otp", "card_number", "cvc"]);
const IDENTIFIERS = new Set(["username", "email", "tel"]);

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

function minutesLeft(expiresAt: number): string {
  const minutes = Math.max(0, Math.ceil((expiresAt - Date.now()) / 60_000));
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

export function CredentialRequestForm({
  taskId,
  request,
  onSettled,
}: {
  taskId: number;
  request: CredentialRequestView;
  onSettled?: () => void;
}) {
  const mutations = useVaultMutations();
  const [values, setValues] = useState<Record<string, string>>({});
  const [save, setSave] = useState(true);
  const [busy, setBusy] = useState(false);

  const host = hostOf(request.origin);
  const where = request.frameOrigin
    ? `${host}, in its sign-in frame from ${hostOf(request.frameOrigin)}`
    : host;
  const moved = request.liveOrigin !== null && request.liveOrigin !== request.origin;
  const canSave = request.fields.some(
    (field) =>
      field.type === "password" ||
      field.type === "card_number" ||
      ((field.type === "email" || field.type === "text") &&
        IDENTIFIERS.has(field.autocomplete ?? "")),
  );
  const missing = request.fields.some((field) => field.required && !values[field.key]?.trim());
  const canContinue = !busy && !missing && !moved;
  const botName = request.bot?.name ?? "A bot";

  const submit = async () => {
    setBusy(true);
    const sending = save && canSave;
    try {
      const result = await mutations.submitRequest.mutateAsync({ taskId, values, save: sending });
      setValues({});
      toast.success(
        result.savedHandle ? `Filled and saved as ${result.savedHandle}` : "Filled into the page",
      );
      onSettled?.();
    } catch (error) {
      toast.error(apiError(error, "Couldn't fill the page"));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await mutations.cancelRequest.mutateAsync(taskId);
      onSettled?.();
    } catch (error) {
      toast.error(apiError(error, "Couldn't cancel"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {moved && (
        <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            The bot's page is now on <span className={monoClass}>{request.liveOrigin}</span>.
            Nothing will be filled there.
          </span>
        </div>
      )}

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (canContinue) void submit();
        }}
      >
        {request.fields.map((field) => {
          const id = `request-${taskId}-${field.key}`;
          const set = (value: string) => setValues((prev) => ({ ...prev, [field.key]: value }));
          return (
            <Field
              key={field.key}
              label={`${field.label}${field.required ? "*" : ""}`}
              htmlFor={id}
            >
              {field.type === "select" ? (
                <Select value={values[field.key] ?? ""} onValueChange={set}>
                  <SelectTrigger id={id}>
                    <SelectValue placeholder="Choose…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(field.options ?? []).map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : MASKED.has(field.type) ? (
                <SecretInput
                  id={id}
                  value={values[field.key] ?? ""}
                  onChange={set}
                  autoComplete={field.autocomplete}
                />
              ) : (
                <Input
                  id={id}
                  type="text"
                  value={values[field.key] ?? ""}
                  onChange={(event) => set(event.target.value)}
                  autoComplete={field.autocomplete}
                  inputMode={
                    field.type === "expiry"
                      ? "numeric"
                      : field.type === "email"
                        ? "email"
                        : undefined
                  }
                />
              )}
            </Field>
          );
        })}

        {canSave && (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {request.savedHandle ? "Update saved login" : "Securely save to vault"}
              </p>
              <p className="text-xs text-muted-foreground">
                One-time codes and security codes are never saved.
              </p>
            </div>
            <Switch checked={save} onCheckedChange={setSave} aria-label="Save to vault" />
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Only filled on {where}. Never shown to {botName}. Expires in{" "}
          {minutesLeft(request.expiresAt)}.
        </p>

        <div className="flex flex-col gap-2">
          <Button type="submit" disabled={!canContinue}>
            Continue
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void cancel()}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
